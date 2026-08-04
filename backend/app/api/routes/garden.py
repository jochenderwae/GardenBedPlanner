from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409, get_active_garden
from app.core.db import get_session
from app.models.bed import Bed
from app.models.garden import Garden as GardenTable
from app.models.geometry import Geometry, parse_geometry

# Singular, legacy-shaped resource (GET/PUT /api/garden - always operates on
# whichever garden is currently active, see _get_garden_row below) and the
# real list-style multi-garden CRUD (#238) live in the same module - same
# "one resource family, several routers" precedent garden_plans.py uses for
# GardenPlan + GardenPlanEntry, since both routers share the exact same
# table/schema/conversion helpers below.
router = APIRouter(prefix="/garden", tags=["garden"])
gardens_router = APIRouter(prefix="/gardens", tags=["gardens"])

# Same split as beds.py: border_geometry is a raw dict at the table level,
# typed as Geometry only at the API boundary.
_GARDEN_TABLE_FIELDS = {name: field for name, field in GardenTable.model_fields.items() if name != "border_geometry"}


def _garden_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


# Read schema: every field, including id and is_active.
Garden = create_model(
    "Garden",
    __base__=BaseModel,
    **{name: _garden_field_tuple(field) for name, field in _GARDEN_TABLE_FIELDS.items()},
    border_geometry=(Geometry, ...),
)

# Full-replace write schema, shared by the legacy PUT /api/garden and the
# new POST /api/gardens - excludes id (server-assigned) *and* is_active
# (#238: never client-settable directly, only via POST /api/gardens/{id}/
# activate - otherwise an ordinary PUT/POST body that omits it would
# silently deactivate whichever garden is currently active).
_GardenWrite = create_model(
    "GardenWrite",
    __base__=BaseModel,
    **{
        name: _garden_field_tuple(field)
        for name, field in _GARDEN_TABLE_FIELDS.items()
        if name not in ("id", "is_active")
    },
    border_geometry=(Geometry, ...),
)

# Partial-update schema for PATCH /api/gardens/{id} - same id/is_active
# exclusion as _GardenWrite, every other field optional.
_GardenUpdate = create_model(
    "GardenUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _GARDEN_TABLE_FIELDS.items()
        if name not in ("id", "is_active")
    },
    border_geometry=(Geometry | None, None),
)


def _to_api_garden(row: GardenTable) -> Garden:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"border_geometry"})
    return Garden(**data, border_geometry=parse_geometry(row.border_geometry))


def _get_garden_row(session: Session) -> GardenTable | None:
    # #238: legacy singular route now resolves to whichever garden is
    # active (falling back to the first garden if none is flagged active -
    # see get_active_garden's own docstring), not "the only garden" the way
    # it did before multi-garden support existed.
    return get_active_garden(session)


def _get_garden_or_404(session: Session, garden_id: int) -> GardenTable:
    garden = session.get(GardenTable, garden_id)
    if garden is None:
        raise HTTPException(status_code=404, detail=f"No garden with id {garden_id}")
    return garden


def _create_garden_with_ground_bed(session: Session, data: dict, *, is_active: bool) -> GardenTable:
    """Shared by put_garden's first-ever-garden path and create_garden
    (POST /api/gardens): a new Garden row plus its own matching
    ground-level Bed (#238 - "one ground bed per garden," tied to that
    garden's own id, superseding the pre-multi-garden one-time global
    default - see the ground_bed docstring this replaced)."""
    row = GardenTable(**data, is_active=is_active)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)

    ground_bed = Bed(
        name="Ground",
        category="Ground",
        border_geometry=row.border_geometry,
        garden_id=row.id,
    )
    session.add(ground_bed)
    commit_or_409(session)
    # The ground-Bed commit above expires every object still attached to the
    # session (SQLAlchemy's default expire_on_commit=True), `row` included -
    # and SQLModel's/Pydantic's model_dump() (used by _to_api_garden) reads
    # straight from the instance's __dict__, not through SQLAlchemy's
    # attribute descriptors, so it doesn't lazy-reload expired attributes
    # the way plain `row.x` attribute access would. Without this second
    # refresh, the response would silently fall back to each field's
    # Pydantic default instead of what was actually just written - the row
    # in the database itself was always correct, only this response
    # serialization was affected.
    session.refresh(row)
    return row


@router.get("", response_model=Garden)
def get_garden(session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    row = _get_garden_row(session)
    if row is None:
        raise HTTPException(status_code=404, detail="No garden defined yet")
    return _to_api_garden(row)


@router.put("", response_model=Garden)
def put_garden(payload: _GardenWrite, session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    """Get-or-create against whichever garden is active (#238): creates the
    garden - and activates it - on first call, updates the active garden on
    every call after. Only the *first* creation also auto-creates a
    matching ground-level Bed - subsequent PUTs never touch Bed rows."""
    row = _get_garden_row(session)
    data = payload.model_dump()

    if row is None:
        return _to_api_garden(_create_garden_with_ground_bed(session, data, is_active=True))

    for field, value in data.items():
        setattr(row, field, value)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return _to_api_garden(row)


@gardens_router.get("", response_model=list[Garden])
def list_gardens(session: Session = Depends(get_session)) -> list[Garden]:  # type: ignore[valid-type]
    rows = list(session.exec(select(GardenTable)).all())
    return [_to_api_garden(row) for row in rows]


@gardens_router.get("/{garden_id}", response_model=Garden)
def get_garden_by_id(garden_id: int, session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    return _to_api_garden(_get_garden_or_404(session, garden_id))


@gardens_router.post("", response_model=Garden, status_code=201)
def create_garden(payload: _GardenWrite, session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    """Every additional garden starts inactive (is_active=False) - switching
    to it is a separate, explicit step (POST /api/gardens/{id}/activate),
    never implicit on creation."""
    return _to_api_garden(_create_garden_with_ground_bed(session, payload.model_dump(), is_active=False))


@gardens_router.patch("/{garden_id}", response_model=Garden)
def update_garden(
    garden_id: int, update: _GardenUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Garden:  # type: ignore[valid-type]
    garden = _get_garden_or_404(session, garden_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(garden, field, value)
    session.add(garden)
    commit_or_409(session)
    session.refresh(garden)
    return _to_api_garden(garden)


@gardens_router.delete("/{garden_id}", status_code=204)
def delete_garden(garden_id: int, session: Session = Depends(get_session)) -> None:
    """#238: garden deletion has no cascade path yet (deliberately, matching
    this app's existing pattern of only building cascade-delete where a
    real, immediate need exists) - refused outright (409) if it's the
    active garden or the only garden, rather than left to whatever a raw FK
    violation on its dependent Beds/GardenPlans would otherwise produce."""
    garden = _get_garden_or_404(session, garden_id)
    if garden.is_active:
        raise HTTPException(status_code=409, detail="Cannot delete the active garden")
    total_gardens = len(list(session.exec(select(GardenTable.id)).all()))
    if total_gardens <= 1:
        raise HTTPException(status_code=409, detail="Cannot delete the only garden")
    session.delete(garden)
    commit_or_409(session)


@gardens_router.post("/{garden_id}/activate", response_model=Garden)
def activate_garden(garden_id: int, session: Session = Depends(get_session)) -> Garden:  # type: ignore[valid-type]
    """Sets this garden is_active=True and every other garden is_active=False,
    in one transaction - never both/neither."""
    garden = _get_garden_or_404(session, garden_id)
    for other in session.exec(select(GardenTable).where(GardenTable.id != garden_id)).all():
        if other.is_active:
            other.is_active = False
            session.add(other)
    garden.is_active = True
    session.add(garden)
    commit_or_409(session)
    session.refresh(garden)
    return _to_api_garden(garden)
