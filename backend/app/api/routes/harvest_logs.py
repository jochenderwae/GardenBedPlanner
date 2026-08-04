from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import active_garden_bed_ids, commit_or_409
from app.core.db import get_session
from app.models.harvest_log import HarvestLog as HarvestLogTable
from app.models.planting import Planting as PlantingTable

router = APIRouter(prefix="/harvest-logs", tags=["harvest-logs"])

_FIELDS = {name: field for name, field in HarvestLogTable.model_fields.items()}


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_HarvestLogCreate = create_model(
    "HarvestLogCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _FIELDS.items() if name != "id"},
)

_HarvestLogUpdate = create_model(
    "HarvestLogUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, harvest_log_id: int) -> HarvestLogTable:
    item = session.get(HarvestLogTable, harvest_log_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No harvest log with id {harvest_log_id}")
    return item


@router.get("", response_model=list[HarvestLogTable])
def list_harvest_logs(
    planting_id: int | None = Query(default=None, description="Only entries for this planting"),
    session: Session = Depends(get_session),
) -> list[HarvestLogTable]:
    query = select(HarvestLogTable)
    # #258: no garden_id or bed_id of its own - transitively scoped two hops
    # out, via its own planting_id -> Planting.bed_id -> Bed.garden_id
    # (planting_id is always set, and every Planting's bed_id is always
    # set too - see each model's own docstring).
    active_bed_ids = active_garden_bed_ids(session)
    if active_bed_ids is not None:
        query = query.join(PlantingTable, PlantingTable.id == HarvestLogTable.planting_id).where(
            PlantingTable.bed_id.in_(active_bed_ids)
        )
    if planting_id is not None:
        query = query.where(HarvestLogTable.planting_id == planting_id)
    return list(session.exec(query).all())


@router.get("/{harvest_log_id}", response_model=HarvestLogTable)
def get_harvest_log(harvest_log_id: int, session: Session = Depends(get_session)) -> HarvestLogTable:
    return _get_or_404(session, harvest_log_id)


@router.post("", response_model=HarvestLogTable, status_code=201)
def create_harvest_log(
    item: _HarvestLogCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> HarvestLogTable:
    row = HarvestLogTable(**item.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{harvest_log_id}", response_model=HarvestLogTable)
def update_harvest_log(
    harvest_log_id: int, update: _HarvestLogUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> HarvestLogTable:
    item = _get_or_404(session, harvest_log_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.delete("/{harvest_log_id}", status_code=204)
def delete_harvest_log(harvest_log_id: int, session: Session = Depends(get_session)) -> None:
    item = _get_or_404(session, harvest_log_id)
    session.delete(item)
    commit_or_409(session)
