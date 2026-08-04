"""Imports data/example_garden.json (produced by data/etl/
generate_example_garden.py - see data/task_queue.md item 9) into the real
Bed/Planting Postgres tables. This is the "future analogous importer"
data-engineer's own CLAUDE.md ("Keeping the importer in sync") anticipated
for import_plants.py - same idempotent spirit, new script because Bed has
no natural key like Plant.slug to key a single upsert loop off of the same
way.

Idempotent, mirroring import_plants.py's own pattern:
- Beds are get-or-create by `name` (the closest thing this fixture has to a
  natural key - Bed has no slug) - update fields if a bed with that name
  already exists, else create it.
- Plantings are delete-then-reinsert-all per bed, same as import_plants.py's
  satellite tables (PlantCompanion, PlantPeriod, ...) - simplest correct
  pattern for a batch import that isn't performance-sensitive, not a diff.
- The *primary* Garden is get-or-create too, but *only* the "create" half
  ever fires: the fixture's `beds` list has no garden-level metadata of its
  own (no name/border/climate fields alongside it), and a real Garden row a
  user already set up (their own boundary shape, orientation, climate zone,
  notes) must never get silently overwritten by a test-data import. So: if
  a Garden row already exists (resolved the same way
  app.api.deps.get_active_garden does - whichever is flagged `is_active`,
  falling back to the first Garden row), leave it untouched; if none exists
  yet, create one (marked `is_active=True`) whose border_geometry is a
  bounding rectangle around every fixture bed (see _beds_bounding_box) plus
  a fixed margin - "a garden exists" is the whole ask (see the backlog item
  this closes), not a physically accurate boundary.
- **Updated 2026-08-04 (GitHub issue #240):** a second, deliberately
  less-complete `secondary_garden` (if the fixture has one - see
  data/etl/generate_example_garden.py's own docstring) gets its own real
  Garden row, get-or-create-*and-update* by `name` this time (not
  hands-off like the primary garden - a fixture-authored secondary garden,
  identified by its own fixture-owned name, has no real user data to
  protect, same reasoning `upsert_bed` already applies to every Bed).
  Always forced `is_active=False`. Every Bed this importer creates or
  updates - primary or secondary - now also gets `garden_id` set to
  whichever Garden it actually belongs to; previously (since #238 added the
  column) this importer left every Bed's `garden_id` at `None`, orphaned
  from the very Garden row it also created - a gap this same change fixes,
  not something #240 introduces.

Ordering dependency: Planting.plant_slug is a FK to plant.slug, so
app.scripts.import_plants must have already been run against the same
database - this script does NOT create Plant rows, it only references them.

Geometry conversion: originally every fixture planting was a flat bed-local
x_cm/y_cm point (see app/api/routes/example_garden.py's ExamplePlanting -
that endpoint deliberately kept this simpler shape rather than the real
Planting model's Geometry column), converted here into a small rectangle
centered on it - 20cm square, matching the frontend's own
DEFAULT_PLANTING_DIAMETER_CM fallback (frontend/src/pages/layout/
geometry.ts) for a planting with no real spread_cm/row_spacing_cm to size a
marker off of.

**Updated 2026-08-04 (GitHub issue #234):** data/etl/generate_example_
garden.py now emits full `geometry`/`placement_type`/`spacing_cm` per
planting directly (one `field`-placement Planting covering a whole cols x
rows stand instead of N `individual` ones - see that module's own
docstring), matching the real Planting shape closely enough that this
importer just uses it as-is rather than deriving it. The old flat x_cm/y_cm
-> centered-rectangle conversion is kept as a fallback for any fixture that
still uses it (e.g. backend/tests/test_import_example_garden.py's and
test_example_garden_route.py's own small hand-written fixtures, and
app/api/routes/example_garden.py's ExamplePlanting/GET response model,
which - unlike this importer - still hard-requires the old x_cm/y_cm shape;
see data/suggestions.md for the follow-up needed there).

Run from backend/: uv run python -m app.scripts.import_example_garden

`seed_example_garden()` is the importable core (used by both `main()` below
and `POST /api/example-garden/seed` in app/api/routes/example_garden.py, so
a running frontend can trigger the same idempotent import over HTTP rather
than needing someone to SSH in and run this script directly).
"""

import json
import math
from dataclasses import dataclass
from dataclasses import field as dc_field
from pathlib import Path

from sqlmodel import Session, delete, select

from app.api.deps import get_active_garden
from app.core.db import engine
from app.models.bed import Bed
from app.models.garden import Garden
from app.models.planting import Planting

# data/ is a sibling of backend/ at the repo root - same relative-path
# pattern app/scripts/import_plants.py already uses to reach data/plants/.
EXAMPLE_GARDEN_PATH = Path(__file__).resolve().parents[3] / "data" / "example_garden.json"

_PLANTING_HALF_SIZE_CM = 10.0  # -> a 20cm square, centered on x_cm/y_cm
_GARDEN_MARGIN_CM = 100.0  # breathing room around the beds' own bounding box


def _legacy_point_geometry(x_cm: float, y_cm: float) -> dict:
    return {
        "type": "rectangle",
        "x": x_cm - _PLANTING_HALF_SIZE_CM,
        "y": y_cm - _PLANTING_HALF_SIZE_CM,
        "width": 2 * _PLANTING_HALF_SIZE_CM,
        "height": 2 * _PLANTING_HALF_SIZE_CM,
        "rotation": 0,
    }


def _planting_fields(p: dict) -> tuple[str, dict, float | None]:
    """(placement_type, geometry, spacing_cm) for a fixture planting -
    prefers the real shape (`geometry`/`placement_type`/`spacing_cm`, as
    data/etl/generate_example_garden.py emits as of GitHub issue #234, and
    example_garden_de_heuvel.json already used) when present, falling back
    to the older flat x_cm/y_cm point -> centered-rectangle conversion for
    any fixture that still uses it (see this module's own docstring)."""
    if "geometry" in p:
        return p.get("placement_type", "individual"), p["geometry"], p.get("spacing_cm")
    return "individual", _legacy_point_geometry(p["x_cm"], p["y_cm"]), None


_BED_SCALAR_FIELDS = ["category", "border_geometry", "height_cm", "has_greenhouse", "soil_type", "sun_level", "notes"]


def upsert_bed(session: Session, bed_data: dict, garden_id: int | None) -> Bed:
    """Get-or-create by (`name`, `garden_id`) - scoped to a single garden
    (#240: two different gardens' beds could otherwise collide on name, e.g.
    both having a "Ground" bed) rather than by `name` alone the way this
    predates #238/#240. Always syncs `garden_id` to whichever Garden this
    bed actually belongs to, per this import pass - see this module's own
    docstring for why that wasn't happening at all before this change."""
    name = bed_data["name"]
    bed = session.exec(select(Bed).where(Bed.name == name, Bed.garden_id == garden_id)).first()
    if bed is None:
        bed = Bed(name=name, garden_id=garden_id)
        session.add(bed)
    for field in _BED_SCALAR_FIELDS:
        if field in bed_data:
            setattr(bed, field, bed_data[field])
    bed.garden_id = garden_id
    session.commit()
    session.refresh(bed)
    return bed


def _rectangle_corners(geometry: dict) -> list[tuple[float, float]]:
    x, y, width, height = geometry["x"], geometry["y"], geometry["width"], geometry["height"]
    corners = [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]
    rotation = geometry.get("rotation", 0)
    if not rotation:
        return corners
    cx, cy = x + width / 2, y + height / 2
    theta = math.radians(rotation)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    return [
        (cx + (px - cx) * cos_t - (py - cy) * sin_t, cy + (px - cx) * sin_t + (py - cy) * cos_t)
        for px, py in corners
    ]


def _geometry_points(geometry: dict) -> list[tuple[float, float]]:
    if geometry.get("type") == "polygon":
        return [(p["x"], p["y"]) for p in geometry["points"]]
    return _rectangle_corners(geometry)


def _beds_bounding_box(beds_data: list[dict]) -> tuple[float, float, float, float]:
    """min_x, min_y, max_x, max_y across every bed's border_geometry -
    rotation-aware for rectangles (compares actual corners, not the
    unrotated x/y/width/height box)."""
    xs: list[float] = []
    ys: list[float] = []
    for bed_data in beds_data:
        for px, py in _geometry_points(bed_data["border_geometry"]):
            xs.append(px)
            ys.append(py)
    return min(xs), min(ys), max(xs), max(ys)


def _bounding_geometry(beds_data: list[dict]) -> dict:
    min_x, min_y, max_x, max_y = _beds_bounding_box(beds_data)
    return {
        "type": "rectangle",
        "x": min_x - _GARDEN_MARGIN_CM,
        "y": min_y - _GARDEN_MARGIN_CM,
        "width": (max_x - min_x) + 2 * _GARDEN_MARGIN_CM,
        "height": (max_y - min_y) + 2 * _GARDEN_MARGIN_CM,
        "rotation": 0,
    }


def import_garden(session: Session, beds_data: list[dict]) -> Garden:
    """Get-or-create the *primary* Garden `beds_data` belongs to - resolved
    the same way app.api.deps.get_active_garden resolves "the" garden
    everywhere else (whichever Garden is flagged `is_active`, falling back
    to the first Garden row if none is), not a bare "does any Garden exist"
    check - matters once a second garden (see import_secondary_garden) can
    also be in the database. Never updates an already-existing row (a real
    Garden a user already customized must never be silently overwritten by
    a test-data import) but always returns the resolved row, existing or
    newly created, so callers can associate every fixture Bed with its real
    `garden_id` (#240 - previously this importer left every Bed's
    `garden_id` at `None`, disconnected from the very Garden row it also
    created)."""
    existing = get_active_garden(session)
    if existing is not None:
        print(f"Garden {existing.name!r} (id={existing.id}) already exists - leaving it untouched.")
        return existing
    garden = Garden(name="My Garden", is_active=True, border_geometry=_bounding_geometry(beds_data))
    session.add(garden)
    session.commit()
    session.refresh(garden)
    print(f"Created Garden {garden.name!r} (id={garden.id}) bounding the example beds.")
    return garden


def import_secondary_garden(session: Session, secondary_data: dict) -> Garden:
    """#240: the second, deliberately less-complete example garden -
    get-or-create-*and-update* by `name` this time (unlike import_garden's
    primary-garden "never touch an existing row" contract: a
    fixture-authored secondary garden, identified by its own fixture-owned
    name, has no real user data to protect the way the primary garden
    might - same reasoning upsert_bed already applies to every Bed). Always
    forced `is_active=False` - this garden exists to be switched to
    (POST /api/gardens/{id}/activate), never the default active one."""
    name = secondary_data["name"]
    beds_data = secondary_data.get("beds", [])
    garden = session.exec(select(Garden).where(Garden.name == name)).first()
    if garden is None:
        garden = Garden(name=name)
        session.add(garden)
    if beds_data:
        garden.border_geometry = _bounding_geometry(beds_data)
    elif garden.id is None:
        # No beds to bound, and this is a brand new row - border_geometry
        # is non-nullable, so fall back to a bare origin box rather than
        # crash (shouldn't happen for this fixture's own secondary garden,
        # which always has beds, but a hand-written test fixture might not).
        garden.border_geometry = {"type": "rectangle", "x": 0, "y": 0, "width": 0, "height": 0, "rotation": 0}
    garden.notes = secondary_data.get("notes", "")
    garden.is_active = False
    session.add(garden)
    session.commit()
    session.refresh(garden)
    print(f"Garden {garden.name!r} (id={garden.id}) - secondary, is_active=False.")
    return garden


def import_plantings(session: Session, bed: Bed, plantings: list[dict]) -> None:
    session.exec(delete(Planting).where(Planting.bed_id == bed.id))
    for p in plantings:
        placement_type, geometry, spacing_cm = _planting_fields(p)
        session.add(
            Planting(
                bed_id=bed.id,
                plant_slug=p["plant_slug"],
                placement_type=placement_type,
                geometry=geometry,
                spacing_cm=spacing_cm,
            )
        )
    session.commit()


@dataclass
class SeedResult:
    beds_imported: int = 0
    beds_failed: int = 0
    failures: list[str] = dc_field(default_factory=list)


def seed_example_garden(session: Session, path: Path = EXAMPLE_GARDEN_PATH) -> SeedResult:
    """Importable core of the import: given an open Session, get-or-create
    the primary Garden and every fixture Bed (replacing each bed's
    Plantings wholesale), same idempotent behaviour whether called from
    main() below or from the HTTP route. Raises FileNotFoundError if the
    fixture hasn't been generated yet (see etl.generate_example_garden) -
    callers decide how to surface that (SystemExit for the CLI, HTTP 404
    for the route).

    #240: if the fixture also has a `secondary_garden` key, that gets its
    own real (always-inactive) Garden row and beds too - a failure
    importing it is recorded in `failures` (and doesn't count toward
    `beds_imported`/`beds_failed`, since it's not a bed) but never aborts
    the primary garden's own import, same "one bad part doesn't sink the
    batch" spirit as every individual bed's own try/except below."""
    if not path.exists():
        raise FileNotFoundError(f"No example garden fixture at {path} - run etl.generate_example_garden first")
    data = json.loads(path.read_text(encoding="utf-8"))
    beds_data = data["beds"]

    result = SeedResult()
    garden = import_garden(session, beds_data)
    for bed_data in beds_data:
        try:
            bed = upsert_bed(session, bed_data, garden.id)
            import_plantings(session, bed, bed_data.get("plantings", []))
            result.beds_imported += 1
        except Exception as exc:  # noqa: BLE001 - one bad bed must not abort the batch
            session.rollback()
            result.failures.append(f"{bed_data.get('name')!r}: {exc!r}")
            result.beds_failed += 1

    secondary_data = data.get("secondary_garden")
    if secondary_data:
        try:
            secondary_garden = import_secondary_garden(session, secondary_data)
        except Exception as exc:  # noqa: BLE001 - a broken secondary garden must not abort the primary import
            session.rollback()
            result.failures.append(f"secondary garden {secondary_data.get('name')!r}: {exc!r}")
        else:
            for bed_data in secondary_data.get("beds", []):
                try:
                    bed = upsert_bed(session, bed_data, secondary_garden.id)
                    import_plantings(session, bed, bed_data.get("plantings", []))
                    result.beds_imported += 1
                except Exception as exc:  # noqa: BLE001
                    session.rollback()
                    result.failures.append(f"{bed_data.get('name')!r} (secondary garden): {exc!r}")
                    result.beds_failed += 1
    return result


def main() -> None:
    print(f"Importing beds from {EXAMPLE_GARDEN_PATH}")
    with Session(engine) as session:
        try:
            result = seed_example_garden(session)
        except FileNotFoundError as exc:
            raise SystemExit(str(exc)) from exc

    for failure in result.failures:
        print(f"FAILED: {failure}")
    print(f"Done. {result.beds_imported} beds imported, {result.beds_failed} failed.")


if __name__ == "__main__":
    main()
