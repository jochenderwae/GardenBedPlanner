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
"""

from datetime import date, timedelta

from pydantic import BaseModel
from sqlmodel import Session, select

from app.models.plant import Family, Plant
from app.models.planting import Planting

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


def check_rotation(
    session: Session,
    bed_id: int,
    candidate_plant: Plant,
    as_of: date,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> RotationWarning:
    """Looks at `bed_id`'s Planting history for anything in the same
    botanical family as `candidate_plant`, planted within `lookback_days`
    of `as_of`. Ignores plantings of the exact same species (that's just
    "the same crop is still/was here", not a family-rotation risk) and
    plantings with no planted_date on file (can't be dated, so
    conservatively not counted as "recent" rather than assumed to be)."""
    if candidate_plant.family_id is None:
        return RotationWarning(has_warning=False)

    cutoff = as_of - timedelta(days=lookback_days)

    rows = list(
        session.exec(
            select(Planting, Plant)
            .join(Plant, Plant.slug == Planting.plant_slug)
            .where(Planting.bed_id == bed_id)
            .where(Plant.family_id == candidate_plant.family_id)
            .where(Planting.plant_slug != candidate_plant.slug)
        ).all()
    )

    recent = [
        (planting, plant)
        for planting, plant in rows
        if planting.planted_date is not None and cutoff <= planting.planted_date <= as_of
    ]
    if not recent:
        return RotationWarning(has_warning=False)

    # Most recent conflicting planting wins if there's more than one.
    planting, plant = max(recent, key=lambda pair: pair[0].planted_date)  # type: ignore[arg-type,return-value]
    family = session.get(Family, candidate_plant.family_id)
    return RotationWarning(
        has_warning=True,
        family_id=candidate_plant.family_id,
        family_name=family.name if family else None,
        conflicting_planting_id=planting.id,
        conflicting_plant_slug=plant.slug,
        conflicting_plant_common_name=plant.common_name,
        conflicting_planted_date=planting.planted_date,
        conflicting_removed_date=planting.removed_date,
    )
