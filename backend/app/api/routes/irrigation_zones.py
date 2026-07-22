from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.api.routes.bed_equipment import BedEquipment as BedEquipmentRead, _to_api_equipment
from app.core.db import get_session
from app.models.bed_equipment import BedEquipment as BedEquipmentTable
from app.models.irrigation_zone import IrrigationZone as IrrigationZoneTable

router = APIRouter(prefix="/irrigation-zones", tags=["irrigation-zones"])

_ZONE_FIELDS = {name: field for name, field in IrrigationZoneTable.model_fields.items()}


def _zone_field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_IrrigationZoneCreate = create_model(
    "IrrigationZoneCreate",
    __base__=BaseModel,
    **{name: _zone_field_tuple(field) for name, field in _ZONE_FIELDS.items() if name != "id"},
)

_IrrigationZoneUpdate = create_model(
    "IrrigationZoneUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _ZONE_FIELDS.items() if name != "id"},
)


class IrrigationZoneDetail(BaseModel):
    """GET /irrigation-zones/{zone_id} response: the zone plus its member
    equipment and their combined water delivery - "the zone's total water
    delivery can be queried/displayed" (#36's test criterion 3).
    total_water_delivery_lph sums only member equipment that has a
    water_delivery_lph set; equipment in the zone without one (e.g. a stake
    grouped in for some other organizational reason) is left out of the sum
    rather than treated as a 0 rate, since "no known rate" and "a known zero
    rate" aren't the same thing. None (not 0) if no member equipment has a
    rate set at all."""

    id: int
    name: str
    notes: str | None = None
    equipment: list[BedEquipmentRead] = []  # type: ignore[valid-type]
    total_water_delivery_lph: float | None = None


def _get_or_404(session: Session, zone_id: int) -> IrrigationZoneTable:
    zone = session.get(IrrigationZoneTable, zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"No irrigation zone with id {zone_id}")
    return zone


@router.get("", response_model=list[IrrigationZoneTable])
def list_irrigation_zones(session: Session = Depends(get_session)) -> list[IrrigationZoneTable]:
    return list(session.exec(select(IrrigationZoneTable)).all())


@router.get("/{zone_id}", response_model=IrrigationZoneDetail)
def get_irrigation_zone(zone_id: int, session: Session = Depends(get_session)) -> IrrigationZoneDetail:
    zone = _get_or_404(session, zone_id)
    rows = list(
        session.exec(select(BedEquipmentTable).where(BedEquipmentTable.zone_id == zone_id)).all()
    )
    equipment = [_to_api_equipment(row) for row in rows]
    rates = [e.water_delivery_lph for e in equipment if e.water_delivery_lph is not None]
    total = sum(rates) if rates else None
    return IrrigationZoneDetail(
        id=zone.id,
        name=zone.name,
        notes=zone.notes,
        equipment=equipment,
        total_water_delivery_lph=total,
    )


@router.post("", response_model=IrrigationZoneTable, status_code=201)
def create_irrigation_zone(
    zone: _IrrigationZoneCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> IrrigationZoneTable:
    row = IrrigationZoneTable(**zone.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{zone_id}", response_model=IrrigationZoneTable)
def update_irrigation_zone(
    zone_id: int, update: _IrrigationZoneUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> IrrigationZoneTable:
    zone = _get_or_404(session, zone_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(zone, field, value)
    session.add(zone)
    commit_or_409(session)
    session.refresh(zone)
    return zone


@router.delete("/{zone_id}", status_code=204)
def delete_irrigation_zone(zone_id: int, session: Session = Depends(get_session)) -> None:
    zone = _get_or_404(session, zone_id)
    # Unassign member equipment rather than deleting/cascading it - equipment
    # not part of any zone still works as ordinary bed equipment (#36's test
    # criterion 4), same "orphaned rows stay usable" reasoning as
    # bed_equipment.bed_id being nullable in the first place.
    equipment_rows = list(
        session.exec(select(BedEquipmentTable).where(BedEquipmentTable.zone_id == zone_id)).all()
    )
    for equipment in equipment_rows:
        equipment.zone_id = None
        session.add(equipment)
    session.delete(zone)
    commit_or_409(session)
