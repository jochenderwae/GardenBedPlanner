"""Real Postgres verification for #111's `import_plants.py` "pass 1.5"
fix - the implementer's own outcome comment explicitly flagged this as
unverified: "Not run against real Postgres - no live DB reachable from
this machine; whoever deploys next should confirm a cultivar sorting
before its parent (e.g. acorn-squash) actually gets parent_plant_slug set
correctly post-import, not just that the import doesn't error."

Reuses `import_plants.py`'s own standalone functions directly
(`upsert_plant`/`set_parent_plant_slug`) against a small, controlled pair
of plants rather than running the full 359-plant real
`data/plants/*.json` import - keeps this fast/isolated and focused on the
actual bug class (self-referential FK ordering), independent of whatever
the real dataset's current exact contents are."""

import pytest
from sqlmodel import Session, select

from app.models.plant import Plant
from app.scripts.import_plants import set_parent_plant_slug, upsert_plant

pytestmark = pytest.mark.integration


def _minimal_plant_data(slug: str, common_name: str, parent_plant_slug: str | None = None) -> dict:
    return {
        "slug": slug,
        "common_name": common_name,
        "botanical_name": "Testus e2eus",
        "parent_plant_slug": parent_plant_slug,
    }


def test_a_cultivar_sorting_alphabetically_before_its_own_parent_still_links_correctly(
    db_session: Session,
) -> None:
    """The real-world shape this bug class comes from, per the module's
    own docstring: data/plants/acorn-squash.json's parent_plant_slug is
    "squash", which sorts alphabetically much later - so files loaded in
    filename order hit the cultivar before its parent exists yet."""
    cultivar = _minimal_plant_data("test-acorn-squash", "Acorn Squash", parent_plant_slug="test-squash")
    species = _minimal_plant_data("test-squash", "Squash")
    loaded = [cultivar, species]  # deliberately cultivar-before-parent, alphabetical order
    known_slugs = {d["slug"] for d in loaded}

    # Pass 1: every Plant row upserted first, parent_plant_slug excluded
    # (matches import_plants.py's own _PLANT_SCALAR_FIELDS exclusion) -
    # this must NOT raise, which is exactly what the old single-pass
    # approach would have done.
    for data in loaded:
        upsert_plant(db_session, data)

    # Pass 1.5: now safe, since both rows exist.
    for data in loaded:
        set_parent_plant_slug(db_session, data, known_slugs)

    cultivar_row = db_session.get(Plant, "test-acorn-squash")
    assert cultivar_row is not None
    assert cultivar_row.parent_plant_slug == "test-squash"
    species_row = db_session.get(Plant, "test-squash")
    assert species_row is not None
    assert species_row.parent_plant_slug is None


def test_set_parent_plant_slug_before_pass_1_completes_would_be_the_actual_failure_mode(
    db_session: Session,
) -> None:
    """Confirms the *problem* set_parent_plant_slug's own pass-1.5 timing
    solves is real, not hypothetical: calling upsert_plant for only the
    cultivar (simulating pass 1 not having reached the parent row yet, the
    exact mid-import state a single-pass approach would hit) and then
    immediately trying to set its parent_plant_slug must raise a real FK
    violation - proving the two-pass split is load-bearing, not
    incidental."""
    cultivar = _minimal_plant_data("test-acorn-squash-2", "Acorn Squash 2", parent_plant_slug="test-squash-2")
    upsert_plant(db_session, cultivar)

    plant = db_session.get(Plant, "test-acorn-squash-2")
    assert plant is not None
    plant.parent_plant_slug = "test-squash-2"  # the parent row doesn't exist yet
    db_session.add(plant)
    with pytest.raises(Exception):  # noqa: B017,PT011 - any DB IntegrityError-family exception is fine here
        db_session.commit()
    db_session.rollback()


def test_set_parent_plant_slug_skips_a_dangling_reference_loudly_instead_of_failing_the_whole_import(
    db_session: Session,
) -> None:
    """A parent slug that genuinely doesn't exist anywhere in the loaded
    batch (a real, already-defended case per the function's own doc -
    "skip and log loudly rather than let one bad reference roll back an
    otherwise-good import") must not raise and must not set anything."""
    cultivar = _minimal_plant_data("test-orphan-cultivar", "Orphan Cultivar", parent_plant_slug="no-such-species")
    upsert_plant(db_session, cultivar)
    known_slugs = {"test-orphan-cultivar"}  # "no-such-species" deliberately absent

    set_parent_plant_slug(db_session, cultivar, known_slugs)  # must not raise

    plant = db_session.get(Plant, "test-orphan-cultivar")
    assert plant is not None
    assert plant.parent_plant_slug is None


def test_re_running_the_import_is_idempotent_and_does_not_duplicate_or_break_the_link(
    db_session: Session,
) -> None:
    cultivar = _minimal_plant_data("test-acorn-squash-3", "Acorn Squash 3", parent_plant_slug="test-squash-3")
    species = _minimal_plant_data("test-squash-3", "Squash 3")
    loaded = [cultivar, species]
    known_slugs = {d["slug"] for d in loaded}

    for _ in range(2):  # simulate re-running the whole import twice
        for data in loaded:
            upsert_plant(db_session, data)
        for data in loaded:
            set_parent_plant_slug(db_session, data, known_slugs)

    rows = list(db_session.exec(select(Plant).where(Plant.slug.in_(["test-acorn-squash-3", "test-squash-3"]))).all())
    assert len(rows) == 2
    cultivar_row = next(r for r in rows if r.slug == "test-acorn-squash-3")
    assert cultivar_row.parent_plant_slug == "test-squash-3"
