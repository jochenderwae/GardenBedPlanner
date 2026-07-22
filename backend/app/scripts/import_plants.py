"""Imports data/plants/*.json (produced by the ETL - see data/etl/) into
Postgres. Idempotent: re-running updates existing Plant rows and replaces
their satellite rows entirely rather than diffing them - simplest correct
pattern for a batch import that isn't performance-sensitive.

Three passes, not one: plant_companion.companion_plant_slug is a FK to
another row in `plant` (self-referential, e.g. acorn-squash -> borage).
A single pass processing files in filename order would fail whenever a
companion reference points to a plant that sorts later and hasn't been
inserted yet - first real end-to-end run hit exactly this. Pass 1 upserts
every Plant row (so every slug exists); pass 2 then replaces every plant's
satellite rows, by which point all FK targets are guaranteed present.

Plant.parent_plant_slug (#111) is the same self-referential-FK problem one
level worse: it lives directly on the `plant` row itself, not a satellite
table, so it can't be deferred to pass 2's satellite loop the way
companions are. A cultivar that sorts alphabetically before its own parent
(data/plants/acorn-squash.json's parent_plant_slug is 'squash', which
sorts much later) would otherwise fail its FK constraint the moment pass
1's per-row commit tries to insert it, since the referenced 'squash' row
wouldn't exist in the table yet - this isn't hypothetical, it's exactly
the shape of data data/etl/parent_plant_slug.py's cultivar backfill
produces. Fixed by excluding parent_plant_slug from pass 1's generic
scalar-field upsert and setting it in a dedicated pass 1.5, once every
Plant row (pass 1) is guaranteed to exist.

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
    PlantGrowingInformation,
    PlantPeriod,
    PlantPestInteraction,
    SeedInfo,
)
from app.services.taxonomy import find_or_create_family, find_or_create_genus

PLANTS_DIR = Path(__file__).resolve().parents[3] / "data" / "plants"

# family_id/genus_id excluded: the JSON export has plain "family"/"genus"
# name strings (see data/plant.schema.json), not ids - resolved separately
# below via find_or_create_family/genus, same as the API's create/update
# handlers (app/api/routes/plants.py) do for a plant edited by hand.
# parent_plant_slug excluded too, but for a different reason (self-
# referential FK ordering, not a name-to-id resolution) - see module
# docstring's "pass 1.5" explanation; set_parent_plant_slug below handles it.
_PLANT_SCALAR_FIELDS = [
    f for f in Plant.model_fields if f not in ("slug", "family_id", "genus_id", "parent_plant_slug")
]


def upsert_plant(session: Session, data: dict) -> None:
    slug = data["slug"]
    plant = session.get(Plant, slug)
    if plant is None:
        plant = Plant(slug=slug)
        session.add(plant)
    for field in _PLANT_SCALAR_FIELDS:
        if field in data:
            setattr(plant, field, data[field])
    plant.family_id = find_or_create_family(session, data.get("family"))
    plant.genus_id = find_or_create_genus(session, data.get("genus"), plant.family_id)
    session.commit()


def set_parent_plant_slug(session: Session, data: dict, known_slugs: set[str]) -> None:
    """Pass 1.5 (see module docstring): only safe to call once every Plant
    row from pass 1 exists, since parent_plant_slug is a self-referential FK
    living on the plant row itself. Same dangling-reference defensiveness as
    import_satellites' companion_slug handling - skip and log loudly rather
    than let one bad reference roll back an otherwise-good import."""
    slug = data["slug"]
    parent_slug = data.get("parent_plant_slug")
    if not parent_slug:
        return
    if parent_slug not in known_slugs:
        print(f"[{slug}] skipping dangling parent_plant_slug {parent_slug!r} (no such plant)")
        return
    plant = session.get(Plant, slug)
    if plant is None:
        return  # pass 1 upsert for this slug already failed - nothing to attach a parent to
    plant.parent_plant_slug = parent_slug
    session.commit()


def import_satellites(session: Session, data: dict, known_slugs: set[str]) -> None:
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
        # Some companion_slug values from the source ETL data (openfarm/
        # homesteader) don't correspond to any of our 359 exported plants -
        # e.g. plural/singular or numbered-variant slugs ("beets", "dill-1")
        # that never survived into the final master list. Skipping (loudly)
        # rather than letting one dangling reference fail this whole plant's
        # satellite import via the FK constraint and roll back everything
        # else (periods, seed_info, other valid companions) along with it.
        # The real fix belongs in the ETL export step (data/etl/export.py) -
        # this is a defensive backstop, not where the data should get clean.
        if c["companion_slug"] not in known_slugs:
            print(f"[{slug}] skipping dangling companion_slug {c['companion_slug']!r} (no such plant)")
            continue
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

    session.exec(delete(PlantGrowingInformation).where(PlantGrowingInformation.plant_slug == slug))
    for gi in data.get("growing_information", []):
        session.add(PlantGrowingInformation(plant_slug=slug, **gi))

    session.commit()


def main() -> None:
    files = sorted(PLANTS_DIR.glob("*.json"))
    print(f"Importing {len(files)} plant files from {PLANTS_DIR}")
    loaded = [(path, json.loads(path.read_text(encoding="utf-8"))) for path in files]

    known_slugs = {data["slug"] for _, data in loaded}

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
                continue  # plant row itself never landed, nothing to attach a parent to
            try:
                set_parent_plant_slug(session, data, known_slugs)
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                print(f"[{path.name}] FAILED (parent_plant_slug): {exc!r}")
                failed += 1

        for path, data in loaded:
            if data["slug"] in failed_slugs:
                continue  # plant row itself never landed, satellites would just fail too
            try:
                import_satellites(session, data, known_slugs)
                ok += 1
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                print(f"[{path.name}] FAILED (satellites): {exc!r}")
                failed += 1

    print(f"Done. {ok} imported, {failed} failed.")


if __name__ == "__main__":
    main()
