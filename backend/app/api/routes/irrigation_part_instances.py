from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, or_, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.geometry import Geometry, parse_geometry
from app.models.irrigation_connection import IrrigationConnection as IrrigationConnectionTable
from app.models.irrigation_part_instance import IrrigationPartInstance as IrrigationPartInstanceTable

# #254: one placed physical unit of an IrrigationPart stock row - see that
# model's own docstring for why this is split out from irrigation_parts.py
# rather than folded into it. Same create_model-from-table-fields pattern
# every other route module here already uses.
router = APIRouter(prefix="/irrigation-part-instances", tags=["irrigation-part-instances"])

# Same split as beds.py/garden.py/plantings.py/bed_equipment.py: geometry is
# a raw dict (or null) at the table level, typed as Geometry only at the API
# boundary (#271).
_INSTANCE_FIELDS = {
    name: field for name, field in IrrigationPartInstanceTable.model_fields.items() if name != "geometry"
}


def _instance_field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


IrrigationPartInstance = create_model(
    "IrrigationPartInstance",
    __base__=BaseModel,
    **{name: _instance_field_tuple(field) for name, field in _INSTANCE_FIELDS.items()},
    geometry=(Geometry | None, None),
)

_IrrigationPartInstanceCreate = create_model(
    "IrrigationPartInstanceCreate",
    __base__=BaseModel,
    **{name: _instance_field_tuple(field) for name, field in _INSTANCE_FIELDS.items() if name != "id"},
    geometry=(Geometry | None, None),
)

_IrrigationPartInstanceUpdate = create_model(
    "IrrigationPartInstanceUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _INSTANCE_FIELDS.items()
        if name != "id"
    },
    geometry=(Geometry | None, None),
)


def _to_api_instance(row: IrrigationPartInstanceTable) -> IrrigationPartInstance:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"geometry"})
    geometry = parse_geometry(row.geometry) if row.geometry is not None else None
    return IrrigationPartInstance(**data, geometry=geometry)


def _get_or_404(session: Session, instance_id: int) -> IrrigationPartInstanceTable:
    instance = session.get(IrrigationPartInstanceTable, instance_id)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"No irrigation part instance with id {instance_id}")
    return instance


def _check_bed_garden_mutually_exclusive(bed_id: int | None, garden_id: int | None) -> None:
    """#271: bed_id and garden_id can't both be set - same "bed-local,
    garden-wide, or unplaced" split BedEquipment already enforces (#207),
    see app/api/routes/bed_equipment.py's own version of this check."""
    if bed_id is not None and garden_id is not None:
        raise HTTPException(
            status_code=400, detail="bed_id and garden_id can't both be set on the same part instance"
        )


@router.get("", response_model=list[IrrigationPartInstance])
def list_irrigation_part_instances(
    part_id: int | None = Query(default=None, description="Only instances of this part"),
    session: Session = Depends(get_session),
) -> list[IrrigationPartInstance]:  # type: ignore[valid-type]
    query = select(IrrigationPartInstanceTable)
    if part_id is not None:
        query = query.where(IrrigationPartInstanceTable.part_id == part_id)
    rows = list(session.exec(query).all())
    return [_to_api_instance(row) for row in rows]


@router.get("/{instance_id}", response_model=IrrigationPartInstance)
def get_irrigation_part_instance(
    instance_id: int, session: Session = Depends(get_session)
) -> IrrigationPartInstance:  # type: ignore[valid-type]
    return _to_api_instance(_get_or_404(session, instance_id))


@router.post("", response_model=IrrigationPartInstance, status_code=201)
def create_irrigation_part_instance(
    instance: _IrrigationPartInstanceCreate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationPartInstance:  # type: ignore[valid-type]
    _check_bed_garden_mutually_exclusive(instance.bed_id, instance.garden_id)
    data = instance.model_dump(exclude={"geometry"})
    geometry = instance.geometry.model_dump() if instance.geometry is not None else None
    row = IrrigationPartInstanceTable(**data, geometry=geometry)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return _to_api_instance(row)


@router.patch("/{instance_id}", response_model=IrrigationPartInstance)
def update_irrigation_part_instance(
    instance_id: int,
    update: _IrrigationPartInstanceUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationPartInstance:  # type: ignore[valid-type]
    instance = _get_or_404(session, instance_id)
    data = update.model_dump(exclude_unset=True)
    new_bed_id = data.get("bed_id", instance.bed_id)
    new_garden_id = data.get("garden_id", instance.garden_id)
    _check_bed_garden_mutually_exclusive(new_bed_id, new_garden_id)
    if "geometry" in data:
        geometry = data["geometry"]
        data["geometry"] = geometry.model_dump() if geometry is not None else None
    for field, value in data.items():
        setattr(instance, field, value)
    session.add(instance)
    commit_or_409(session)
    session.refresh(instance)
    return _to_api_instance(instance)


@router.delete("/{instance_id}", status_code=204)
def delete_irrigation_part_instance(instance_id: int, session: Session = Depends(get_session)) -> None:
    instance = _get_or_404(session, instance_id)
    # Only this instance's own connections are removed - a sibling instance
    # of the same part type (a different physical unit) keeps its own
    # connections untouched, per #254's own test criterion 4.
    connections = list(
        session.exec(
            select(IrrigationConnectionTable).where(
                or_(
                    IrrigationConnectionTable.from_instance_id == instance_id,
                    IrrigationConnectionTable.to_instance_id == instance_id,
                )
            )
        ).all()
    )
    for connection in connections:
        session.delete(connection)
    session.delete(instance)
    commit_or_409(session)
