from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.bed import Bed
from app.models.soil_rotation import SoilRotationEvent as SoilRotationEventTable
from app.models.soil_rotation import SoilRotationTransfer as SoilRotationTransferTable
from app.services.soil_rotation import copy_forward_soil_family_history

# #228: one "moving day" (a SoilRotationEvent) can involve any number of
# beds (SoilRotationTransfer edges) - created together in one request/one
# transaction, same "resource family" bundling garden_plans.py uses for
# GardenPlan + GardenPlanEntry. No PATCH/DELETE for a first pass: a logged
# rotation event is a historical fact, not something users are expected to
# edit after the fact (see app/models/soil_rotation.py's own docstring).
router = APIRouter(prefix="/soil-rotation-events", tags=["soil-rotation"])


class SoilRotationTransferCreate(BaseModel):
    from_bed_id: int | None = None
    to_bed_id: int


class SoilRotationEventCreate(BaseModel):
    event_date: date
    notes: str = ""
    transfers: list[SoilRotationTransferCreate]


class SoilRotationEventDetail(BaseModel):
    """GET (list/detail) and POST response shape: the event plus its
    transfers, mirroring garden_plans.py's GardenPlanDetail pattern (a flat
    header response that also assembles its satellite rows)."""

    id: int
    event_date: date
    notes: str = ""
    transfers: list[SoilRotationTransferTable] = []


def _get_event_or_404(session: Session, event_id: int) -> SoilRotationEventTable:
    event = session.get(SoilRotationEventTable, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"No soil rotation event with id {event_id}")
    return event


def _to_detail(session: Session, event: SoilRotationEventTable) -> SoilRotationEventDetail:
    transfers = list(
        session.exec(
            select(SoilRotationTransferTable).where(
                SoilRotationTransferTable.soil_rotation_event_id == event.id
            )
        ).all()
    )
    return SoilRotationEventDetail(
        id=event.id,  # type: ignore[arg-type]
        event_date=event.event_date,
        notes=event.notes,
        transfers=transfers,
    )


@router.get("", response_model=list[SoilRotationEventDetail])
def list_soil_rotation_events(session: Session = Depends(get_session)) -> list[SoilRotationEventDetail]:
    events = list(session.exec(select(SoilRotationEventTable)).all())
    return [_to_detail(session, event) for event in events]


@router.get("/{event_id}", response_model=SoilRotationEventDetail)
def get_soil_rotation_event(event_id: int, session: Session = Depends(get_session)) -> SoilRotationEventDetail:
    return _to_detail(session, _get_event_or_404(session, event_id))


@router.post("", response_model=SoilRotationEventDetail, status_code=201)
def create_soil_rotation_event(
    payload: SoilRotationEventCreate, session: Session = Depends(get_session)
) -> SoilRotationEventDetail:
    """Creates the event, all its transfers, and triggers the
    SoilFamilyHistory copy-forward in one transaction - session.flush()
    (not commit) between steps assigns primary keys without ending the
    transaction early, one real commit_or_409 at the very end."""
    if not payload.transfers:
        raise HTTPException(status_code=400, detail="A soil rotation event needs at least one transfer")

    bed_ids = {t.to_bed_id for t in payload.transfers} | {
        t.from_bed_id for t in payload.transfers if t.from_bed_id is not None
    }
    existing_bed_ids = set(session.exec(select(Bed.id).where(Bed.id.in_(bed_ids))).all()) if bed_ids else set()
    missing_bed_ids = bed_ids - existing_bed_ids
    if missing_bed_ids:
        raise HTTPException(status_code=404, detail=f"No bed(s) with id(s) {sorted(missing_bed_ids)}")

    event = SoilRotationEventTable(event_date=payload.event_date, notes=payload.notes)
    session.add(event)
    session.flush()

    transfer_rows = [
        SoilRotationTransferTable(
            soil_rotation_event_id=event.id, from_bed_id=t.from_bed_id, to_bed_id=t.to_bed_id
        )
        for t in payload.transfers
    ]
    for row in transfer_rows:
        session.add(row)
    session.flush()

    copy_forward_soil_family_history(session, event, transfer_rows)
    commit_or_409(session)
    session.refresh(event)
    return _to_detail(session, event)
