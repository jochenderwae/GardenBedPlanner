"""Imports data/plants/*.json (produced by the ETL - see data/etl/) into
Postgres. Idempotent: re-running updates existing Plant rows and replaces
their satellite rows entirely rather than diffing them - simplest correct
pattern for a batch import that isn't performance-sensitive.

Two passes, not one: plant_companion.companion_plant_slug is a FK to
another row in `plant` (self-referential, e.g. acorn-squash -> borage).
A single pass processing files in filename order would fail whenever a
companion reference points to a plant that sorts later and hasn't been
inserted yet - first real end-to-end run hit exactly this. Pass 1 upserts
every Plant row (so every slug exists); pass 2 then replaces every plant's
satellite rows, by which point all FK targets are guaranteed present.

Run from backend/: uv run python -m app.scripts.import_plants
"""

import json
from pathlib import Path

from sqlmodel import Session, delete

from app.core.db import engine
from app.models.plant import (
    Plant,
    PlantBeddingNeed,
    PlantCompanion,
    PlantDataSource,
    PlantPeriod,
    PlantPestInteraction,
    SeedInfo,
)

PLANTS_DIR = Path(__file__).resolve().parents[3] / "data" / "plants"

_PLANT_SCALAR_FIELDS = [f for f in Plant.model_fields if f != "slug"]


def upsert_plant(session: Session, data: dict) -> None:
    slug = data["slug"]
    plant = session.get(Plant, slug)
    if plant is None:
        plant = Plant(slug=slug)
        session.add(plant)
    for field in _PLANT_SCALAR_FIELDS:
        if field in data:
            setattr(plant, field, data[field])
    session.commit()


def import_satellites(session: Session, data: dict) -> None:
    slug = data["slug"]

    session.exec(delete(PlantDataSource).where(PlantDataSource.plant_slug == slug))
    for s in data.get("data_sources", []):
        session.add(PlantDataSource(plant_slug=slug, **s))

    session.exec(delete(SeedInfo).where(SeedInfo.plant_slug == slug))
    if data.get("seed_info"):
        session.add(SeedInfo(plant_slug=slug, **data["seed_info"]))

    session.exec(delete(PlantPeriod).where(PlantPeriod.plant_slug == slug))
    for p in data.get("periods", []):
        session.add(PlantPeriod(plant_slug=slug, **p))

    session.exec(delete(PlantCompanion).where(PlantCompanion.plant_slug == slug))
    for c in data.get("companions", []):
        # Field name differs deliberately: the JSON schema calls this
        # companion_slug (unambiguous within one plant's own file), but the
        # DB column is companion_plant_slug (needs to be distinct from this
        # table's own plant_slug column) - every other satellite table's
        # JSON keys match their model field names exactly and can use **kwargs
        # unpacking, this one can't.
        session.add(
            PlantCompanion(
                plant_slug=slug,
                companion_plant_slug=c["companion_slug"],
                relationship=c["relationship"],
                mechanism=c.get("mechanism"),
                notes=c.get("notes"),
            )
        )

    session.exec(delete(PlantBeddingNeed).where(PlantBeddingNeed.plant_slug == slug))
    for b in data.get("bedding_needs", []):
        session.add(PlantBeddingNeed(plant_slug=slug, **b))

    session.exec(delete(PlantPestInteraction).where(PlantPestInteraction.plant_slug == slug))
    for pi in data.get("pest_interactions", []):
        session.add(PlantPestInteraction(plant_slug=slug, **pi))

    session.commit()


def main() -> None:
    files = sorted(PLANTS_DIR.glob("*.json"))
    print(f"Importing {len(files)} plant files from {PLANTS_DIR}")
    loaded = [(path, json.loads(path.read_text(encoding="utf-8"))) for path in files]

    ok, failed = 0, 0
    failed_slugs: set[str] = set()
    with Session(engine) as session:
        for path, data in loaded:
            try:
                upsert_plant(session, data)
            except Exception as exc:  # noqa: BLE001 - one bad file must not abort the batch
                session.rollback()
                print(f"[{path.name}] FAILED (plant): {exc!r}")
                failed += 1
                failed_slugs.add(data["slug"])

        for path, data in loaded:
            if data["slug"] in failed_slugs:
                continue  # plant row itself never landed, satellites would just fail too
            try:
                import_satellites(session, data)
                ok += 1
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                print(f"[{path.name}] FAILED (satellites): {exc!r}")
                failed += 1

    print(f"Done. {ok} imported, {failed} failed.")


if __name__ == "__main__":
    main()
