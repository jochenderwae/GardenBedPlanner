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
"""

import json
from pathlib import Path

from sqlmodel import Session, delete, select

from app.core.db import engine
from app.models.bed import Bed
from app.models.planting import Planting

# data/ is a sibling of backend/ at the repo root - same relative-path
# pattern app/scripts/import_plants.py already uses to reach data/plants/.
EXAMPLE_GARDEN_PATH = Path(__file__).resolve().parents[3] / "data" / "example_garden.json"

_PLANTING_HALF_SIZE_CM = 10.0  # -> a 20cm square, centered on x_cm/y_cm


def _planting_geometry(x_cm: float, y_cm: float) -> dict:
    return {
        "type": "rectangle",
        "x": x_cm - _PLANTING_HALF_SIZE_CM,
        "y": y_cm - _PLANTING_HALF_SIZE_CM,
        "width": 2 * _PLANTING_HALF_SIZE_CM,
        "height": 2 * _PLANTING_HALF_SIZE_CM,
        "rotation": 0,
    }


_BED_SCALAR_FIELDS = ["category", "border_geometry", "height_cm", "has_greenhouse", "orientation", "is_raised", "soil_type", "sun_level", "notes"]


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


def main() -> None:
    if not EXAMPLE_GARDEN_PATH.exists():
        raise SystemExit(f"No example garden fixture at {EXAMPLE_GARDEN_PATH} - run etl.generate_example_garden first")
    data = json.loads(EXAMPLE_GARDEN_PATH.read_text(encoding="utf-8"))
    beds_data = data["beds"]
    print(f"Importing {len(beds_data)} beds from {EXAMPLE_GARDEN_PATH}")

    ok, failed = 0, 0
    with Session(engine) as session:
        for bed_data in beds_data:
            try:
                bed = upsert_bed(session, bed_data)
                import_plantings(session, bed, bed_data.get("plantings", []))
                ok += 1
            except Exception as exc:  # noqa: BLE001 - one bad bed must not abort the batch
                session.rollback()
                print(f"[{bed_data.get('name')!r}] FAILED: {exc!r}")
                failed += 1

    print(f"Done. {ok} beds imported, {failed} failed.")


if __name__ == "__main__":
    main()
