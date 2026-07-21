from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from app.core.db import get_session
from app.models.bed import Bed
from app.models.plant import Plant
from app.services.rotation import DEFAULT_LOOKBACK_DAYS, RotationWarning, check_rotation

# Separate router/module from beds.py (same pattern as bed_equipment.py) -
# this is a read-only planning query, not bed CRUD, even though it's
# nested under /beds/{bed_id}.
router = APIRouter(prefix="/beds", tags=["rotation"])


@router.get("/{bed_id}/rotation-check", response_model=RotationWarning)
def rotation_check(
    bed_id: int,
    plant_slug: str = Query(...),
    as_of: date = Query(default_factory=date.today),
    lookback_days: int = Query(default=DEFAULT_LOOKBACK_DAYS, ge=1),
    session: Session = Depends(get_session),
) -> RotationWarning:
    if session.get(Bed, bed_id) is None:
        raise HTTPException(status_code=404, detail=f"No bed with id {bed_id}")
    plant = session.get(Plant, plant_slug)
    if plant is None:
        raise HTTPException(status_code=404, detail=f"No plant with slug {plant_slug!r}")
    return check_rotation(session, bed_id, plant, as_of, lookback_days)
