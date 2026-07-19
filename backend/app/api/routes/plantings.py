from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.geometry import Geometry, parse_geometry
from app.models.planting import Planting as PlantingTable

router = APIRouter(prefix="/plantings", tags=["plantings"])

# Same split as beds.py/garden.py: geometry is a raw dict at the table
# level, typed as Geometry only at the API boundary.
_PLANTING_TABLE_FIELDS = {name: field for name, field in PlantingTable.model_fields.items() if name != "geometry"}


def _planting_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


Planting = create_model(
    "Planting",
    __base__=BaseModel,
    **{name: _planting_field_tuple(field) for name, field in _PLANTING_TABLE_FIELDS.items()},
    geometry=(Geometry, ...),
)

_PlantingCreate = create_model(
    "PlantingCreate",
    __base__=BaseModel,
    **{name: _planting_field_tuple(field) for name, field in _PLANTING_TABLE_FIELDS.items() if name != "id"},
    geometry=(Geometry, ...),
)

_PlantingUpdate = create_model(
    "PlantingUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _PLANTING_TABLE_FIELDS.items()
        if name != "id"
    },
    geometry=(Geometry | None, None),
)


def _to_api_planting(row: PlantingTable) -> Planting:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"geometry"})
    return Planting(**data, geometry=parse_geometry(row.geometry))


def _get_or_404(session: Session, planting_id: int) -> PlantingTable:
    planting = session.get(PlantingTable, planting_id)
    if planting is None:
        raise HTTPException(status_code=404, detail=f"No planting with id {planting_id}")
    return planting


@router.get("", response_model=list[Planting])
def list_plantings(session: Session = Depends(get_session)) -> list[Planting]:  # type: ignore[valid-type]
    rows = list(session.exec(select(PlantingTable)).all())
    return [_to_api_planting(row) for row in rows]


@router.get("/{planting_id}", response_model=Planting)
def get_planting(planting_id: int, session: Session = Depends(get_session)) -> Planting:  # type: ignore[valid-type]
    return _to_api_planting(_get_or_404(session, planting_id))


@router.post("", response_model=Planting, status_code=201)
def create_planting(planting: _PlantingCreate, session: Session = Depends(get_session)) -> Planting:  # type: ignore[valid-type]
    row = PlantingTable(**planting.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return _to_api_planting(row)


@router.patch("/{planting_id}", response_model=Planting)
def update_planting(
    planting_id: int, update: _PlantingUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Planting:  # type: ignore[valid-type]
    planting = _get_or_404(session, planting_id)
    changes = update.model_dump(exclude_unset=True)
    # geometry is always bed-local: moving a planting to a different bed
    # without supplying new coordinates would silently reinterpret the old
    # bed's coordinates against the new bed, which is meaningless.
    if "bed_id" in changes and changes["bed_id"] != planting.bed_id and "geometry" not in changes:
        raise HTTPException(
            status_code=400,
            detail="Changing bed_id requires a new geometry in the same request",
        )
    for field, value in changes.items():
        setattr(planting, field, value)
    session.add(planting)
    commit_or_409(session)
    session.refresh(planting)
    return _to_api_planting(planting)


@router.delete("/{planting_id}", status_code=204)
def delete_planting(planting_id: int, session: Session = Depends(get_session)) -> None:
    planting = _get_or_404(session, planting_id)
    session.delete(planting)
    commit_or_409(session)
