"""Family-based rotation/succession warnings - flags whether a candidate
plant shares a botanical family with something recently grown in a given
bed (see root CLAUDE.md's domain note: rotation/disease-carryover risk keys
off crop family - legumes, brassicas, nightshades, roots, alliums, leafy
greens - not just repeat plantings of the exact same species).

Reuses Plant.family_id (see app/models/plant.py's Family/Genus docstrings)
as the family grouping rather than inventing a separate crop-family
taxonomy - it's the structured data already on file, populated by the ETL
pipeline, and exactly what root CLAUDE.md's domain note is describing
(Solanaceae ~ nightshades, Brassicaceae ~ brassicas, Fabaceae ~ legumes,
etc.).

#228: also checks a bed's *inherited* soil-family-history (see
app/models/soil_rotation.py) - Dave doesn't rotate crops between fixed
beds, he physically moves topsoil between beds every few years, and the
disease-carryover risk travels with the soil, not with the bed's physical
location.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from pydantic import BaseModel
from sqlmodel import Session, select

from app.models.plant import Family, Plant
from app.models.planting import Planting
from app.models.soil_rotation import SoilFamilyHistory, SoilRotationEvent, SoilRotationTransfer

# How far back a same-family planting still counts as a rotation risk.
# No agronomic reference dictates this exact figure - it's a reasonable
# default (roughly 2 growing seasons) pending real-world tuning, and callers
# can override it via the rotation-check endpoint's lookback_days param.
DEFAULT_LOOKBACK_DAYS = 730


class RotationWarning(BaseModel):
    has_warning: bool
    family_id: int | None = None
    family_name: str | None = None
    conflicting_planting_id: int | None = None
    conflicting_plant_slug: str | None = None
    conflicting_plant_common_name: str | None = None
    conflicting_planted_date: date | None = None
    conflicting_removed_date: date | None = None
    # #228: true when the conflicting fact came from this bed's *inherited*
    # soil-family-history (a SoilFamilyHistory row - the soil now in this
    # bed grew a conflicting family somewhere else), not this bed's own
    # native Planting rows. conflicting_planting_id is always null in that
    # case (an inherited fact has no real Planting row behind it, only a
    # SoilFamilyHistory row).
    conflicting_via_soil_transfer: bool = False
    # The bed the conflicting soil-inherited fact originally grew in - null
    # whenever conflicting_via_soil_transfer is false. Lets the frontend
    # (#229) word the tooltip "soil moved here from Bed X" without a
    # separate denormalized name field (the frontend already resolves bed
    # ids to names client-side elsewhere).
    conflicting_source_bed_id: int | None = None


@dataclass
class _Candidate:
    """One comparable conflicting fact - either a native Planting or an
    inherited SoilFamilyHistory row, normalized to the same shape so both
    kinds can be compared/picked-from together by recency."""

    recency_date: date
    conflicting_planting_id: int | None
    conflicting_plant_slug: str
    conflicting_plant_common_name: str | None
    conflicting_planted_date: date | None
    conflicting_removed_date: date | None
    conflicting_via_soil_transfer: bool
    conflicting_source_bed_id: int | None


def _latest_transfer_to_bed(session: Session, bed_id: int) -> tuple[SoilRotationTransfer, date] | None:
    """The most recent SoilRotationTransfer targeting `bed_id` (by its
    parent SoilRotationEvent's event_date), if any - this bed's "soil
    horizon". None if this bed has never been a rotation destination,
    which must behave exactly as check_rotation did before #228 existed."""
    rows = list(
        session.exec(
            select(SoilRotationTransfer, SoilRotationEvent)
            .join(SoilRotationEvent, SoilRotationEvent.id == SoilRotationTransfer.soil_rotation_event_id)
            .where(SoilRotationTransfer.to_bed_id == bed_id)
        ).all()
    )
    if not rows:
        return None
    transfer, event = max(rows, key=lambda pair: (pair[1].event_date, pair[0].id))  # type: ignore[arg-type,return-value]
    return transfer, event.event_date


def check_rotation(
    session: Session,
    bed_id: int,
    candidate_plant: Plant,
    as_of: date,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> RotationWarning:
    """Looks at `bed_id`'s Planting history *and* inherited soil-family
    history (#228) for anything in the same botanical family as
    `candidate_plant`, planted within `lookback_days` of `as_of`. Ignores
    plantings of the exact same species (that's just "the same crop is
    still/was here", not a family-rotation risk) and plantings with no
    planted_date on file (can't be dated, so conservatively not counted as
    "recent" rather than assumed to be)."""
    if candidate_plant.family_id is None:
        return RotationWarning(has_warning=False)

    cutoff = as_of - timedelta(days=lookback_days)
    candidates: list[_Candidate] = []

    # This bed's soil horizon: the date its soil most recently arrived
    # (from a real transfer, or a fresh-soil reset) - None if this bed has
    # never been a rotation destination, in which case the native check
    # below behaves exactly as it did before #228.
    horizon = _latest_transfer_to_bed(session, bed_id)
    horizon_date = horizon[1] if horizon else None

    native_rows = list(
        session.exec(
            select(Planting, Plant)
            .join(Plant, Plant.slug == Planting.plant_slug)
            .where(Planting.bed_id == bed_id)
            .where(Plant.family_id == candidate_plant.family_id)
            .where(Planting.plant_slug != candidate_plant.slug)
        ).all()
    )
    for planting, plant in native_rows:
        if planting.planted_date is None or not (cutoff <= planting.planted_date <= as_of):
            continue
        # A bed's own pre-rotation planting history stops counting once
        # its original soil has moved away (#228) - only applies once this
        # bed actually has a soil horizon.
        if horizon_date is not None and planting.planted_date < horizon_date:
            continue
        candidates.append(
            _Candidate(
                recency_date=planting.planted_date,
                conflicting_planting_id=planting.id,
                conflicting_plant_slug=plant.slug,
                conflicting_plant_common_name=plant.common_name,
                conflicting_planted_date=planting.planted_date,
                conflicting_removed_date=planting.removed_date,
                conflicting_via_soil_transfer=False,
                conflicting_source_bed_id=None,
            )
        )

    # Inherited check (#228): only when the horizon transfer was a real
    # soil transfer (a non-null from_bed_id) - a fresh-soil reset
    # (from_bed_id=None) has nothing to inherit, the "clean slate" case.
    if horizon is not None and horizon[0].from_bed_id is not None:
        horizon_transfer = horizon[0]
        history_rows = list(
            session.exec(
                select(SoilFamilyHistory)
                .where(SoilFamilyHistory.bed_id == bed_id)
                .where(SoilFamilyHistory.family_id == candidate_plant.family_id)
                .where(SoilFamilyHistory.soil_rotation_event_id == horizon_transfer.soil_rotation_event_id)
            ).all()
        )
        for hist in history_rows:
            if hist.source_plant_slug == candidate_plant.slug:
                continue
            if not (cutoff <= hist.source_planted_date <= as_of):
                continue
            plant = session.get(Plant, hist.source_plant_slug)
            candidates.append(
                _Candidate(
                    recency_date=hist.source_planted_date,
                    conflicting_planting_id=None,
                    conflicting_plant_slug=hist.source_plant_slug,
                    conflicting_plant_common_name=plant.common_name if plant else None,
                    conflicting_planted_date=hist.source_planted_date,
                    conflicting_removed_date=None,
                    conflicting_via_soil_transfer=True,
                    conflicting_source_bed_id=hist.source_bed_id,
                )
            )

    if not candidates:
        return RotationWarning(has_warning=False)

    # Most recent conflicting fact wins if there's more than one, whether
    # it's a native planting or an inherited soil-history fact.
    winner = max(candidates, key=lambda c: c.recency_date)
    family = session.get(Family, candidate_plant.family_id)
    return RotationWarning(
        has_warning=True,
        family_id=candidate_plant.family_id,
        family_name=family.name if family else None,
        conflicting_planting_id=winner.conflicting_planting_id,
        conflicting_plant_slug=winner.conflicting_plant_slug,
        conflicting_plant_common_name=winner.conflicting_plant_common_name,
        conflicting_planted_date=winner.conflicting_planted_date,
        conflicting_removed_date=winner.conflicting_removed_date,
        conflicting_via_soil_transfer=winner.conflicting_via_soil_transfer,
        conflicting_source_bed_id=winner.conflicting_source_bed_id,
    )
