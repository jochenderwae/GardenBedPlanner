from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.bed import Bed as BedTable
from app.models.bed_equipment import BedEquipment
from app.models.geometry import Geometry, parse_geometry
from app.models.planting import Planting

router = APIRouter(prefix="/beds", tags=["beds"])

# Every BedTable field except border_geometry, which is stored as a raw
# dict at the table level (Postgres jsonb) and only gets its real
# discriminated-union type (Geometry) here at the API boundary - same
# split app/api/routes/plants.py uses for family/genus (FK ints in the
# table, nested read objects in the API).
_BED_TABLE_FIELDS = {name: field for name, field in BedTable.model_fields.items() if name != "border_geometry"}


def _bed_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


# API read/write shape for a bed. Deliberately not `class Bed(BedTable)` -
# SQLModel's metaclass turns every added field into a table column even on
# a subclass without its own table=True (same reasoning plants.py's own
# `Plant` read schema documents).
Bed = create_model(
    "Bed",
    __base__=BaseModel,
    **{name: _bed_field_tuple(field) for name, field in _BED_TABLE_FIELDS.items()},
    border_geometry=(Geometry, ...),
)

_BedCreate = create_model(
    "BedCreate",
    __base__=BaseModel,
    **{name: _bed_field_tuple(field) for name, field in _BED_TABLE_FIELDS.items() if name != "id"},
    border_geometry=(Geometry, ...),
)

# See plants.py's _PlantUpdate for why this is generated from the table's
# own fields rather than retyped by hand.
_BedUpdate = create_model(
    "BedUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _BED_TABLE_FIELDS.items()
        if name != "id"
    },
    border_geometry=(Geometry | None, None),
)


def _to_api_bed(row: BedTable) -> Bed:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"border_geometry"})
    return Bed(**data, border_geometry=parse_geometry(row.border_geometry))


def _get_or_404(session: Session, bed_id: int) -> BedTable:
    bed = session.get(BedTable, bed_id)
    if bed is None:
        raise HTTPException(status_code=404, detail=f"No bed with id {bed_id}")
    return bed


@router.get("", response_model=list[Bed])
def list_beds(session: Session = Depends(get_session)) -> list[Bed]:  # type: ignore[valid-type]
    rows = list(session.exec(select(BedTable)).all())
    return [_to_api_bed(row) for row in rows]


@router.get("/{bed_id}", response_model=Bed)
def get_bed(bed_id: int, session: Session = Depends(get_session)) -> Bed:  # type: ignore[valid-type]
    return _to_api_bed(_get_or_404(session, bed_id))


@router.post("", response_model=Bed, status_code=201)
def create_bed(bed: _BedCreate, session: Session = Depends(get_session)) -> Bed:  # type: ignore[valid-type]
    data = bed.model_dump()
    row = BedTable(**data)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return _to_api_bed(row)


@router.patch("/{bed_id}", response_model=Bed)
def update_bed(
    bed_id: int, update: _BedUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Bed:  # type: ignore[valid-type]
    bed = _get_or_404(session, bed_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(bed, field, value)
    session.add(bed)
    commit_or_409(session)
    session.refresh(bed)
    return _to_api_bed(bed)


@router.delete("/{bed_id}", status_code=204)
def delete_bed(
    bed_id: int, cascade: bool = False, session: Session = Depends(get_session)
) -> None:
    bed = _get_or_404(session, bed_id)
    if cascade:
        for planting in session.exec(select(Planting).where(Planting.bed_id == bed_id)).all():
            session.delete(planting)
        for equipment in session.exec(
            select(BedEquipment).where(BedEquipment.bed_id == bed_id)
        ).all():
            session.delete(equipment)
        # No SQLAlchemy `relationship()` links Bed to Planting/BedEquipment
        # (plain FK columns only - see each model's own docstring), so the
        # ORM's unit-of-work has no dependency info to order these deletes
        # against the bed's own delete below; without an explicit flush here
        # it can (and did, verified against garden_test) emit the bed's
        # DELETE first and hit the FK constraint it's trying to avoid.
        session.flush()
    session.delete(bed)
    commit_or_409(session)
