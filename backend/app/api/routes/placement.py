from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.db import get_session
from app.models.bed import Bed
from app.models.garden import Garden
from app.models.geometry import Geometry
from app.models.plant import Plant
from app.services.placement import (
    DEFAULT_NEIGHBOR_DISTANCE_CM,
    PlacementCheck,
    check_placement,
)

# Separate router/module from beds.py and plantings.py (same pattern as
# rotation.py/bed_equipment.py) - a read-only planning query nested under
# /beds/{bed_id}, not bed or planting CRUD.
router = APIRouter(prefix="/beds", tags=["placement"])


class PlacementCheckRequest(BaseModel):
    """POST, not GET-with-query-params, because `geometry` is a nested
    discriminated-union object (rectangle|polygon) - the same reason
    beds.py/plantings.py take a JSON body for create/update instead of
    query params, even though this itself doesn't write anything."""

    plant_slug: str
    geometry: Geometry
    as_of: date = Field(default_factory=date.today)
    neighbor_distance_cm: float = DEFAULT_NEIGHBOR_DISTANCE_CM
    # Set this to the Planting's own id when re-checking a placement that's
    # already saved (e.g. after editing an existing planting's geometry) -
    # otherwise it would show up as its own neighbor.
    exclude_planting_id: int | None = None


@router.post("/{bed_id}/placement-check", response_model=PlacementCheck)
def placement_check(
    bed_id: int,
    payload: PlacementCheckRequest,
    session: Session = Depends(get_session),
) -> PlacementCheck:
    bed = session.get(Bed, bed_id)
    if bed is None:
        raise HTTPException(status_code=404, detail=f"No bed with id {bed_id}")
    plant = session.get(Plant, payload.plant_slug)
    if plant is None:
        raise HTTPException(status_code=404, detail=f"No plant with slug {payload.plant_slug!r}")
    garden = session.exec(select(Garden)).first()
    if garden is None:
        raise HTTPException(status_code=404, detail="No garden defined yet")
    return check_placement(
        session,
        bed,
        plant,
        payload.geometry.model_dump(),
        garden,
        neighbor_distance_cm=payload.neighbor_distance_cm,
        as_of=payload.as_of,
        exclude_planting_id=payload.exclude_planting_id,
    )
