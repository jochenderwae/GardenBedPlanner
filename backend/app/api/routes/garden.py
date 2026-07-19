from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.bed import Bed
from app.models.garden import Garden as GardenTable
from app.models.geometry import Geometry, parse_geometry

router = APIRouter(prefix="/garden", tags=["garden"])

# Same split as beds.py: border_geometry is a raw dict at the table level,
# typed as Geometry only at the API boundary.
_GARDEN_TABLE_FIELDS = {name: field for name, field in GardenTable.model_fields.items() if name != "border_geometry"}


def _garden_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


Garden = create_model(
    "Garden",
    __base__=BaseModel,
    **{name: _garden_field_tuple(field) for name, field in _GARDEN_TABLE_FIELDS.items()},
    border_geometry=(Geometry, ...),
)

_GardenPut = create_model(
    "GardenPut",
    __base__=BaseModel,
    **{name: _garden_field_tuple(field) for name, field in _GARDEN_TABLE_FIELDS.items() if name != "id"},
    border_geometry=(Geometry, ...),
)


def _to_api_garden(row: GardenTable) -> Garden:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"border_geometry"})
    return Garden(**data, border_geometry=parse_geometry(row.border_geometry))


def _get_garden_row(session: Session) -> GardenTable | None:
    # Singular by convention (GET/PUT /api/garden, not list-style /gardens),
    # not by a DB constraint - see garden.py's own docstring for why.
    return session.exec(select(GardenTable)).first()


@router.get("", response_model=Garden)
def get_garden(session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    row = _get_garden_row(session)
    if row is None:
        raise HTTPException(status_code=404, detail="No garden defined yet")
    return _to_api_garden(row)


@router.put("", response_model=Garden)
def put_garden(payload: _GardenPut, session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    """Get-or-create: creates the garden on first call, updates it on every
    call after. Only the *first* creation also auto-creates a matching
    ground-level Bed (see the docstring on that block below) - subsequent
    PUTs never touch Bed rows."""
    row = _get_garden_row(session)
    is_new = row is None
    data = payload.model_dump()

    if row is None:
        row = GardenTable(**data)
        session.add(row)
    else:
        for field, value in data.items():
            setattr(row, field, value)
        session.add(row)
    commit_or_409(session)
    session.refresh(row)

    if is_new:
        # One-time convenience default (see the redesign that introduced
        # this): the first time a Garden is created, give the user a
        # matching ground-level Bed to plant directly in - "planting in the
        # garden" is then just "planting in this bed," not a separate
        # garden-space coordinate system. Deliberately not kept in lockstep
        # with later Garden edits (it's a starting point, not an invariant)
        # - an ordinary Bed row the user can reshape/rename/delete freely.
        ground_bed = Bed(
            name="Ground",
            category="Ground",
            border_geometry=row.border_geometry,
            is_raised=False,
        )
        session.add(ground_bed)
        commit_or_409(session)

    return _to_api_garden(row)
