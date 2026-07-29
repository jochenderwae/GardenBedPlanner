"""Imports data/equipment_types.json (produced by #206's research, see that
file's own top-level "_notes") into Postgres. Idempotent: re-running
upserts by slug, same "safe to run again" contract as import_plants.py.

Run from backend/: uv run python -m app.scripts.import_equipment_types
"""

import json
from pathlib import Path

from sqlmodel import Session, select

from app.core.db import engine
from app.models.equipment_type import EquipmentType

EQUIPMENT_TYPES_FILE = Path(__file__).resolve().parents[3] / "data" / "equipment_types.json"

# is_placeholder/category_reasoning/sourcing_note are research-provenance
# metadata for humans reading the JSON file directly (see that file's
# _notes) - not modeled as EquipmentType columns, so excluded here rather
# than failing on an unexpected kwarg.
_ENTRY_FIELDS = ("slug", "name", "category", "default_geometry", "default_height_cm")


def upsert_equipment_type(session: Session, entry: dict) -> None:
    slug = entry["slug"]
    row = session.exec(select(EquipmentType).where(EquipmentType.slug == slug)).first()
    if row is None:
        row = EquipmentType(slug=slug)
        session.add(row)
    for field in _ENTRY_FIELDS:
        if field == "slug":
            continue
        if field in entry:
            setattr(row, field, entry[field])
    session.commit()


def main() -> None:
    data = json.loads(EQUIPMENT_TYPES_FILE.read_text(encoding="utf-8"))
    entries = data["equipment_types"]
    print(f"Importing {len(entries)} equipment types from {EQUIPMENT_TYPES_FILE}")

    ok, failed = 0, 0
    with Session(engine) as session:
        for entry in entries:
            try:
                upsert_equipment_type(session, entry)
                ok += 1
            except Exception as exc:  # noqa: BLE001 - one bad entry must not abort the batch
                session.rollback()
                print(f"[{entry.get('slug')}] FAILED: {exc!r}")
                failed += 1

    print(f"Done. {ok} imported, {failed} failed.")


if __name__ == "__main__":
    main()
