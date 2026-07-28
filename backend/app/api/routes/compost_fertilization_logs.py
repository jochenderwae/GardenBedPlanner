from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.compost_fertilization_log import CompostFertilizationLog as CompostFertilizationLogTable

router = APIRouter(prefix="/compost-fertilization-logs", tags=["compost-fertilization-logs"])

_FIELDS = {name: field for name, field in CompostFertilizationLogTable.model_fields.items()}


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_CompostFertilizationLogCreate = create_model(
    "CompostFertilizationLogCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _FIELDS.items() if name != "id"},
)

_CompostFertilizationLogUpdate = create_model(
    "CompostFertilizationLogUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, log_id: int) -> CompostFertilizationLogTable:
    item = session.get(CompostFertilizationLogTable, log_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No compost/fertilization log with id {log_id}")
    return item


@router.get("", response_model=list[CompostFertilizationLogTable])
def list_compost_fertilization_logs(
    bed_id: int | None = Query(default=None, description="Only entries for this bed"),
    log_date_from: date | None = Query(default=None, description="Only entries logged on/after this date"),
    log_date_to: date | None = Query(default=None, description="Only entries logged on/before this date"),
    session: Session = Depends(get_session),
) -> list[CompostFertilizationLogTable]:
    query = select(CompostFertilizationLogTable)
    if bed_id is not None:
        query = query.where(CompostFertilizationLogTable.bed_id == bed_id)
    if log_date_from is not None:
        query = query.where(CompostFertilizationLogTable.log_date >= log_date_from)
    if log_date_to is not None:
        query = query.where(CompostFertilizationLogTable.log_date <= log_date_to)
    query = query.order_by(CompostFertilizationLogTable.log_date)
    return list(session.exec(query).all())


@router.get("/{log_id}", response_model=CompostFertilizationLogTable)
def get_compost_fertilization_log(
    log_id: int, session: Session = Depends(get_session)
) -> CompostFertilizationLogTable:
    return _get_or_404(session, log_id)


@router.post("", response_model=CompostFertilizationLogTable, status_code=201)
def create_compost_fertilization_log(
    item: _CompostFertilizationLogCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> CompostFertilizationLogTable:
    row = CompostFertilizationLogTable(**item.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{log_id}", response_model=CompostFertilizationLogTable)
def update_compost_fertilization_log(
    log_id: int, update: _CompostFertilizationLogUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> CompostFertilizationLogTable:
    item = _get_or_404(session, log_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.delete("/{log_id}", status_code=204)
def delete_compost_fertilization_log(log_id: int, session: Session = Depends(get_session)) -> None:
    item = _get_or_404(session, log_id)
    session.delete(item)
    commit_or_409(session)
