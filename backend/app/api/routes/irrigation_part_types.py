from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.irrigation_part_type import IrrigationPartType as IrrigationPartTypeTable
from app.models.resource_pack import ResourcePack as ResourcePackTable

router = APIRouter(prefix="/irrigation-part-types", tags=["irrigation-part-types"])

_PART_TYPE_FIELDS = {name: field for name, field in IrrigationPartTypeTable.model_fields.items()}


def _field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_IrrigationPartTypeCreate = create_model(
    "IrrigationPartTypeCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _PART_TYPE_FIELDS.items() if name != "id"},
)

_IrrigationPartTypeUpdate = create_model(
    "IrrigationPartTypeUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _PART_TYPE_FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, part_type_id: int) -> IrrigationPartTypeTable:
    part_type = session.get(IrrigationPartTypeTable, part_type_id)
    if part_type is None:
        raise HTTPException(status_code=404, detail=f"No irrigation part type with id {part_type_id}")
    return part_type


@router.get("", response_model=list[IrrigationPartTypeTable])
def list_irrigation_part_types(
    include_inactive: bool = False, session: Session = Depends(get_session)
) -> list[IrrigationPartTypeTable]:
    """Defaults to only part types belonging to an active resource pack -
    #251's own test criterion 3: this is the list the "add a new part"
    suggestion UI consumes, and an inactive pack's parts shouldn't show up
    there. Pass include_inactive=true for a management view that needs to
    see/edit every part type regardless of its pack's toggle state (e.g.
    when reactivating a pack)."""
    if include_inactive:
        return list(session.exec(select(IrrigationPartTypeTable)).all())
    rows = session.exec(
        select(IrrigationPartTypeTable)
        .join(ResourcePackTable, IrrigationPartTypeTable.resource_pack_id == ResourcePackTable.id)
        .where(ResourcePackTable.is_active == True)  # noqa: E712
    ).all()
    return list(rows)


@router.get("/{part_type_id}", response_model=IrrigationPartTypeTable)
def get_irrigation_part_type(
    part_type_id: int, session: Session = Depends(get_session)
) -> IrrigationPartTypeTable:
    return _get_or_404(session, part_type_id)


@router.post("", response_model=IrrigationPartTypeTable, status_code=201)
def create_irrigation_part_type(
    part_type: _IrrigationPartTypeCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> IrrigationPartTypeTable:
    row = IrrigationPartTypeTable(**part_type.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{part_type_id}", response_model=IrrigationPartTypeTable)
def update_irrigation_part_type(
    part_type_id: int,
    update: _IrrigationPartTypeUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationPartTypeTable:
    part_type = _get_or_404(session, part_type_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(part_type, field, value)
    session.add(part_type)
    commit_or_409(session)
    session.refresh(part_type)
    return part_type


@router.delete("/{part_type_id}", status_code=204)
def delete_irrigation_part_type(part_type_id: int, session: Session = Depends(get_session)) -> None:
    part_type = _get_or_404(session, part_type_id)
    session.delete(part_type)
    commit_or_409(session)
