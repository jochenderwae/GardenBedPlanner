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
- Garden is get-or-create too, but *only* the "create" half ever fires:
  the fixture has no garden-level metadata of its own (no name/border/
  climate fields anywhere in example_garden.json, just a flat "beds" list),
  and a real Garden row a user already set up (their own boundary shape,
  orientation, climate zone, notes) must never get silently overwritten by
  a test-data import. So: if a Garden row already exists, leave it
  untouched; if none exists yet, create one whose border_geometry is a
  bounding rectangle around every fixture bed (see _beds_bounding_box)
  plus a fixed margin - "a garden exists" is the whole ask (see the
  backlog item this closes), not a physically accurate boundary.

Ordering dependency: Planting.plant_slug is a FK to plant.slug, so
app.scripts.import_plants must have already been run against the same
database - this script does NOT create Plant rows, it only references them.

Geometry conversion: the fixture's plantings are flat bed-local x_cm/y_cm
points (see app/api/routes/example_garden.py's ExamplePlanting - that
endpoint deliberately kept this simpler shape rather than the real Planting
model's Geometry column), but Planting.geometry has no bare point/marker
variant (app/models/geometry.py's Geometry union is rectangle|polygon only).
Each point becomes a small rectangle centered on it - 20cm square, matching
the frontend's own DEFAULT_PLANTING_DIAMETER_CM fallback
(frontend/src/pages/layout/geometry.ts) for a planting with no real
spread_cm/row_spacing_cm to size a marker off of.

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

from app.core.db import engine
from app.models.bed import Bed
from app.models.garden import Garden
from app.models.planting import Planting

# data/ is a sibling of backend/ at the repo root - same relative-path
# pattern app/scripts/import_plants.py already uses to reach data/plants/.
EXAMPLE_GARDEN_PATH = Path(__file__).resolve().parents[3] / "data" / "example_garden.json"

_PLANTING_HALF_SIZE_CM = 10.0  # -> a 20cm square, centered on x_cm/y_cm
_GARDEN_MARGIN_CM = 100.0  # breathing room around the beds' own bounding box


def _planting_geometry(x_cm: float, y_cm: float) -> dict:
    return {
        "type": "rectangle",
        "x": x_cm - _PLANTING_HALF_SIZE_CM,
        "y": y_cm - _PLANTING_HALF_SIZE_CM,
        "width": 2 * _PLANTING_HALF_SIZE_CM,
        "height": 2 * _PLANTING_HALF_SIZE_CM,
        "rotation": 0,
    }


_BED_SCALAR_FIELDS = ["category", "border_geometry", "height_cm", "has_greenhouse", "orientation", "soil_type", "sun_level", "notes"]


def upsert_bed(session: Session, bed_data: dict) -> Bed:
    name = bed_data["name"]
    bed = session.exec(select(Bed).where(Bed.name == name)).first()
    if bed is None:
        bed = Bed(name=name)
        session.add(bed)
    for field in _BED_SCALAR_FIELDS:
        if field in bed_data:
            setattr(bed, field, bed_data[field])
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


def import_garden(session: Session, beds_data: list[dict]) -> None:
    existing = session.exec(select(Garden)).first()
    if existing is not None:
        print(f"Garden {existing.name!r} (id={existing.id}) already exists - leaving it untouched.")
        return
    min_x, min_y, max_x, max_y = _beds_bounding_box(beds_data)
    garden = Garden(
        name="My Garden",
        border_geometry={
            "type": "rectangle",
            "x": min_x - _GARDEN_MARGIN_CM,
            "y": min_y - _GARDEN_MARGIN_CM,
            "width": (max_x - min_x) + 2 * _GARDEN_MARGIN_CM,
            "height": (max_y - min_y) + 2 * _GARDEN_MARGIN_CM,
            "rotation": 0,
        },
    )
    session.add(garden)
    session.commit()
    print(f"Created Garden {garden.name!r} (id={garden.id}) bounding the example beds.")


def import_plantings(session: Session, bed: Bed, plantings: list[dict]) -> None:
    session.exec(delete(Planting).where(Planting.bed_id == bed.id))
    for p in plantings:
        session.add(
            Planting(
                bed_id=bed.id,
                plant_slug=p["plant_slug"],
                geometry=_planting_geometry(p["x_cm"], p["y_cm"]),
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
    the Garden and every fixture Bed (replacing each bed's Plantings
    wholesale), same idempotent behaviour whether called from main() below
    or from the HTTP route. Raises FileNotFoundError if the fixture hasn't
    been generated yet (see etl.generate_example_garden) - callers decide
    how to surface that (SystemExit for the CLI, HTTP 404 for the route)."""
    if not path.exists():
        raise FileNotFoundError(f"No example garden fixture at {path} - run etl.generate_example_garden first")
    data = json.loads(path.read_text(encoding="utf-8"))
    beds_data = data["beds"]

    result = SeedResult()
    import_garden(session, beds_data)
    for bed_data in beds_data:
        try:
            bed = upsert_bed(session, bed_data)
            import_plantings(session, bed, bed_data.get("plantings", []))
            result.beds_imported += 1
        except Exception as exc:  # noqa: BLE001 - one bad bed must not abort the batch
            session.rollback()
            result.failures.append(f"{bed_data.get('name')!r}: {exc!r}")
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
