from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.bed_equipment import BedEquipment as BedEquipmentTable
from app.models.bed_equipment import EquipmentCondition
from app.models.geometry import Geometry, parse_geometry
from app.services.task_generation import generate_equipment_tasks

router = APIRouter(prefix="/bed-equipment", tags=["bed-equipment"])

# Same split as beds.py/garden.py/plantings.py: geometry is a raw dict (or
# null, while unassigned) at the table level, typed as Geometry only at the
# API boundary.
_EQUIPMENT_TABLE_FIELDS = {
    name: field for name, field in BedEquipmentTable.model_fields.items() if name != "geometry"
}


def _equipment_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


BedEquipment = create_model(
    "BedEquipment",
    __base__=BaseModel,
    **{name: _equipment_field_tuple(field) for name, field in _EQUIPMENT_TABLE_FIELDS.items()},
    geometry=(Geometry | None, None),
)

_BedEquipmentCreate = create_model(
    "BedEquipmentCreate",
    __base__=BaseModel,
    **{name: _equipment_field_tuple(field) for name, field in _EQUIPMENT_TABLE_FIELDS.items() if name != "id"},
    geometry=(Geometry | None, None),
)

_BedEquipmentUpdate = create_model(
    "BedEquipmentUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _EQUIPMENT_TABLE_FIELDS.items()
        if name != "id"
    },
    geometry=(Geometry | None, None),
)


def _to_api_equipment(row: BedEquipmentTable) -> BedEquipment:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"geometry"})
    geometry = parse_geometry(row.geometry) if row.geometry is not None else None
    return BedEquipment(**data, geometry=geometry)


def _get_or_404(session: Session, equipment_id: int) -> BedEquipmentTable:
    equipment = session.get(BedEquipmentTable, equipment_id)
    if equipment is None:
        raise HTTPException(status_code=404, detail=f"No bed equipment with id {equipment_id}")
    return equipment


def _check_bed_garden_mutually_exclusive(bed_id: int | None, garden_id: int | None) -> None:
    """#207: bed_id and garden_id can't both be set - equipment is either
    bed-local, garden-wide, or unplaced inventory (both null), never both at
    once. Enforced here rather than a DB check constraint, same "API-layer,
    not schema-layer" precedent as this module's other cross-field rules."""
    if bed_id is not None and garden_id is not None:
        raise HTTPException(
            status_code=400, detail="bed_id and garden_id can't both be set on the same equipment"
        )


@router.get("", response_model=list[BedEquipment])
def list_bed_equipment(
    condition: EquipmentCondition | None = Query(
        default=None,
        description="Only equipment in this condition - e.g. condition=good for an "
        "'available to place' picker that shouldn't silently offer damaged/retired items.",
    ),
    session: Session = Depends(get_session),
) -> list[BedEquipment]:  # type: ignore[valid-type]
    query = select(BedEquipmentTable)
    if condition is not None:
        query = query.where(BedEquipmentTable.condition == condition)
    rows = list(session.exec(query).all())
    return [_to_api_equipment(row) for row in rows]


@router.get("/{equipment_id}", response_model=BedEquipment)
def get_bed_equipment(equipment_id: int, session: Session = Depends(get_session)) -> BedEquipment:  # type: ignore[valid-type]
    return _to_api_equipment(_get_or_404(session, equipment_id))


@router.post("", response_model=BedEquipment, status_code=201)
def create_bed_equipment(
    equipment: _BedEquipmentCreate,  # type: ignore[valid-type]
    is_initial_state: bool = False,
    session: Session = Depends(get_session),
) -> BedEquipment:  # type: ignore[valid-type]
    """is_initial_state: set when backfilling equipment that's already in
    place in the real garden, not when the gardener is placing it now -
    skips auto-generating an install_equipment task (#192)."""
    _check_bed_garden_mutually_exclusive(equipment.bed_id, equipment.garden_id)
    row = BedEquipmentTable(**equipment.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    generate_equipment_tasks(session, row, is_initial_state=is_initial_state)
    commit_or_409(session)
    # See beds.py's create_bed for why this second refresh is needed - the
    # commit above expires row's attributes, and _to_api_equipment's
    # model_dump() reads straight from __dict__, not through SQLAlchemy's
    # lazy-reloading descriptors.
    session.refresh(row)
    return _to_api_equipment(row)


@router.patch("/{equipment_id}", response_model=BedEquipment)
def update_bed_equipment(
    equipment_id: int, update: _BedEquipmentUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> BedEquipment:  # type: ignore[valid-type]
    equipment = _get_or_404(session, equipment_id)
    data = update.model_dump(exclude_unset=True)
    new_bed_id = data.get("bed_id", equipment.bed_id)
    new_garden_id = data.get("garden_id", equipment.garden_id)
    _check_bed_garden_mutually_exclusive(new_bed_id, new_garden_id)
    for field, value in data.items():
        setattr(equipment, field, value)
    session.add(equipment)
    commit_or_409(session)
    session.refresh(equipment)
    return _to_api_equipment(equipment)


@router.delete("/{equipment_id}", status_code=204)
def delete_bed_equipment(equipment_id: int, session: Session = Depends(get_session)) -> None:
    equipment = _get_or_404(session, equipment_id)
    session.delete(equipment)
    commit_or_409(session)
