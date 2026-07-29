from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.equipment_type import EquipmentType as EquipmentTypeTable
from app.models.geometry import Geometry, parse_geometry

router = APIRouter(prefix="/equipment-types", tags=["equipment-types"])

# Same split as beds.py/garden.py/bed_equipment.py: default_geometry is a
# raw dict at the table level, typed as Geometry only at the API boundary.
_EQUIPMENT_TYPE_FIELDS = {
    name: field for name, field in EquipmentTypeTable.model_fields.items() if name != "default_geometry"
}


def _field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


EquipmentType = create_model(
    "EquipmentType",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _EQUIPMENT_TYPE_FIELDS.items()},
    default_geometry=(Geometry, ...),
)

_EquipmentTypeCreate = create_model(
    "EquipmentTypeCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _EQUIPMENT_TYPE_FIELDS.items() if name != "id"},
    default_geometry=(Geometry, ...),
)

_EquipmentTypeUpdate = create_model(
    "EquipmentTypeUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _EQUIPMENT_TYPE_FIELDS.items()
        if name != "id"
    },
    default_geometry=(Geometry | None, None),
)


def _to_api_equipment_type(row: EquipmentTypeTable) -> EquipmentType:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"default_geometry"})
    return EquipmentType(**data, default_geometry=parse_geometry(row.default_geometry))


def _get_or_404(session: Session, equipment_type_id: int) -> EquipmentTypeTable:
    equipment_type = session.get(EquipmentTypeTable, equipment_type_id)
    if equipment_type is None:
        raise HTTPException(status_code=404, detail=f"No equipment type with id {equipment_type_id}")
    return equipment_type


@router.get("", response_model=list[EquipmentType])
def list_equipment_types(session: Session = Depends(get_session)) -> list[EquipmentType]:  # type: ignore[valid-type]
    rows = list(session.exec(select(EquipmentTypeTable)).all())
    return [_to_api_equipment_type(row) for row in rows]


@router.get("/{equipment_type_id}", response_model=EquipmentType)
def get_equipment_type(equipment_type_id: int, session: Session = Depends(get_session)) -> EquipmentType:  # type: ignore[valid-type]
    return _to_api_equipment_type(_get_or_404(session, equipment_type_id))


@router.post("", response_model=EquipmentType, status_code=201)
def create_equipment_type(
    equipment_type: _EquipmentTypeCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> EquipmentType:  # type: ignore[valid-type]
    row = EquipmentTypeTable(**equipment_type.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return _to_api_equipment_type(row)


@router.patch("/{equipment_type_id}", response_model=EquipmentType)
def update_equipment_type(
    equipment_type_id: int,
    update: _EquipmentTypeUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> EquipmentType:  # type: ignore[valid-type]
    equipment_type = _get_or_404(session, equipment_type_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(equipment_type, field, value)
    session.add(equipment_type)
    commit_or_409(session)
    session.refresh(equipment_type)
    return _to_api_equipment_type(equipment_type)


@router.delete("/{equipment_type_id}", status_code=204)
def delete_equipment_type(equipment_type_id: int, session: Session = Depends(get_session)) -> None:
    equipment_type = _get_or_404(session, equipment_type_id)
    session.delete(equipment_type)
    commit_or_409(session)
