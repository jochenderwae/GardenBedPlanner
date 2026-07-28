from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.compost_bin import CompostBin as CompostBinTable

router = APIRouter(prefix="/compost-bins", tags=["compost-bins"])

_FIELDS = {name: field for name, field in CompostBinTable.model_fields.items()}


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_CompostBinCreate = create_model(
    "CompostBinCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _FIELDS.items() if name != "id"},
)

_CompostBinUpdate = create_model(
    "CompostBinUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, compost_bin_id: int) -> CompostBinTable:
    item = session.get(CompostBinTable, compost_bin_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No compost bin with id {compost_bin_id}")
    return item


@router.get("", response_model=list[CompostBinTable])
def list_compost_bins(
    bed_id: int | None = Query(default=None, description="Only the compost bin for this bed"),
    session: Session = Depends(get_session),
) -> list[CompostBinTable]:
    query = select(CompostBinTable)
    if bed_id is not None:
        query = query.where(CompostBinTable.bed_id == bed_id)
    return list(session.exec(query).all())


@router.get("/{compost_bin_id}", response_model=CompostBinTable)
def get_compost_bin(compost_bin_id: int, session: Session = Depends(get_session)) -> CompostBinTable:
    return _get_or_404(session, compost_bin_id)


@router.post("", response_model=CompostBinTable, status_code=201)
def create_compost_bin(
    item: _CompostBinCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> CompostBinTable:
    row = CompostBinTable(**item.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{compost_bin_id}", response_model=CompostBinTable)
def update_compost_bin(
    compost_bin_id: int, update: _CompostBinUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> CompostBinTable:
    item = _get_or_404(session, compost_bin_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.delete("/{compost_bin_id}", status_code=204)
def delete_compost_bin(compost_bin_id: int, session: Session = Depends(get_session)) -> None:
    item = _get_or_404(session, compost_bin_id)
    session.delete(item)
    commit_or_409(session)
