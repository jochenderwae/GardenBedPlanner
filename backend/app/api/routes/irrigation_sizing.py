from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from app.core.db import get_session
from app.models.bed import Bed
from app.services.irrigation_sizing import IrrigationSizing, compute_irrigation_sizing

# Separate router/module from beds.py (same "read-only planning query
# nested under /beds/{bed_id}" pattern as placement.py/rotation.py), not
# bed CRUD.
router = APIRouter(prefix="/beds", tags=["irrigation-sizing"])


@router.get("/{bed_id}/irrigation-sizing", response_model=IrrigationSizing)
def get_irrigation_sizing(
    bed_id: int,
    desired_runtime_hours_per_week: float | None = Query(
        default=None,
        description=(
            "If given, also compute required_lph_for_desired_runtime - the "
            "nozzle rating (L/hour) needed to deliver the bed's target "
            "weekly volume within this many hours/week."
        ),
    ),
    session: Session = Depends(get_session),
) -> IrrigationSizing:
    bed = session.get(Bed, bed_id)
    if bed is None:
        raise HTTPException(status_code=404, detail=f"No bed with id {bed_id}")
    return compute_irrigation_sizing(session, bed, desired_runtime_hours_per_week)
