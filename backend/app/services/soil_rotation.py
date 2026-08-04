"""#228: copy-forward logic for a logged SoilRotationEvent - see
app/models/soil_rotation.py's own module docstring for the full data-model
rationale (why a derived SoilFamilyHistory summary is copied forward
instead of reassigning Planting rows directly).
"""

from datetime import date

from sqlmodel import Session, select

from app.models.plant import Plant
from app.models.planting import Planting
from app.models.soil_rotation import SoilFamilyHistory, SoilRotationEvent, SoilRotationTransfer


def copy_forward_soil_family_history(
    session: Session, event: SoilRotationEvent, transfers: list[SoilRotationTransfer]
) -> None:
    """For every transfer in this event with a non-null from_bed_id:
    computes from_bed_id's current total family-risk set (its own native
    Planting rows plus any SoilFamilyHistory it already holds, so a soil
    that's moved more than once correctly carries forward everything it
    picked up along the way, not just what it grew before its most recent
    move) and inserts one new SoilFamilyHistory row per fact onto
    to_bed_id, tagged to this event. A transfer with from_bed_id=None
    (fresh/external soil) contributes nothing - there's nothing to
    inherit.

    N-way cycles in one event (A->B, B->C, C->A) must all read *pre-event*
    state - if bed B is both a transfer's destination (A->B) and another
    transfer's source (B->C) within the same event, C must inherit B's
    soil as it stood *before* this event ran, not soil this same event's
    A->B transfer just handed to B a moment earlier. Every source
    fact-set is gathered via SELECT up front, before a single row for this
    event is inserted, both to avoid that ordering-dependent contamination
    and to match this app's now-standard "gather everything before
    mutating" cascade-safety pattern (see beds.py's cascade_delete_bed_
    dependents for the read-side of the same principle).
    """
    facts_by_transfer: list[tuple[SoilRotationTransfer, list[tuple[int, date, int, str]]]] = []
    for transfer in transfers:
        if transfer.from_bed_id is None:
            facts_by_transfer.append((transfer, []))
            continue

        facts: list[tuple[int, date, int, str]] = []
        native_rows = list(
            session.exec(
                select(Planting, Plant)
                .join(Plant, Plant.slug == Planting.plant_slug)
                .where(Planting.bed_id == transfer.from_bed_id)
                .where(Plant.family_id.is_not(None))
                # No planted_date on file can't be dated - conservatively
                # excluded, same "no date, no risk" reasoning check_rotation
                # already applies to native Plantings.
                .where(Planting.planted_date.is_not(None))
            ).all()
        )
        for planting, plant in native_rows:
            facts.append((plant.family_id, planting.planted_date, transfer.from_bed_id, plant.slug))  # type: ignore[arg-type]

        existing_history = list(
            session.exec(select(SoilFamilyHistory).where(SoilFamilyHistory.bed_id == transfer.from_bed_id)).all()
        )
        for hist in existing_history:
            # Provenance stays the *original* source (hist.source_bed_id/
            # source_plant_slug/source_planted_date), not this intermediate
            # bed - "soil moved A->B->C" means C's tooltip should say "from
            # A", not "from B".
            facts.append((hist.family_id, hist.source_planted_date, hist.source_bed_id, hist.source_plant_slug))

        facts_by_transfer.append((transfer, facts))

    for transfer, facts in facts_by_transfer:
        for family_id, source_planted_date, source_bed_id, source_plant_slug in facts:
            session.add(
                SoilFamilyHistory(
                    bed_id=transfer.to_bed_id,
                    family_id=family_id,
                    source_planted_date=source_planted_date,
                    source_bed_id=source_bed_id,
                    source_plant_slug=source_plant_slug,
                    soil_rotation_event_id=event.id,  # type: ignore[arg-type]
                )
            )
