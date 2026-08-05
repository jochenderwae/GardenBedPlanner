from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409, get_active_garden
from app.core.db import get_session
from app.models.decoration import Decoration as DecorationTable
from app.models.geometry import Geometry, parse_geometry

router = APIRouter(prefix="/decorations", tags=["decorations"])

# Every DecorationTable field except border_geometry, which is stored as a
# raw dict at the table level (Postgres jsonb) and only gets its real
# discriminated-union type (Geometry) here at the API boundary - same split
# app/api/routes/beds.py uses.
_DECORATION_TABLE_FIELDS = {
    name: field for name, field in DecorationTable.model_fields.items() if name != "border_geometry"
}


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


# API read/write shape for a decoration. Deliberately not
# `class Decoration(DecorationTable)` - SQLModel's metaclass turns every
# added field into a table column even on a subclass without its own
# table=True (see beds.py's own Bed schema for the same reasoning).
Decoration = create_model(
    "Decoration",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _DECORATION_TABLE_FIELDS.items()},
    border_geometry=(Geometry, ...),
)

_DecorationCreate = create_model(
    "DecorationCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _DECORATION_TABLE_FIELDS.items() if name != "id"},
    border_geometry=(Geometry, ...),
)

_DecorationUpdate = create_model(
    "DecorationUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _DECORATION_TABLE_FIELDS.items()
        if name != "id"
    },
    border_geometry=(Geometry | None, None),
)


def _to_api_decoration(row: DecorationTable) -> Decoration:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"border_geometry"})
    return Decoration(**data, border_geometry=parse_geometry(row.border_geometry))


def _get_or_404(session: Session, decoration_id: int) -> DecorationTable:
    decoration = session.get(DecorationTable, decoration_id)
    if decoration is None:
        raise HTTPException(status_code=404, detail=f"No decoration with id {decoration_id}")
    return decoration


@router.get("", response_model=list[Decoration])
def list_decorations(session: Session = Depends(get_session)) -> list[Decoration]:  # type: ignore[valid-type]
    # #266: scoped to whichever garden is currently active - unfiltered only
    # when no Garden exists at all yet (get_active_garden returns None),
    # same as list_beds (app/api/routes/beds.py) and every other
    # garden-owned list route since #258.
    query = select(DecorationTable)
    active_garden = get_active_garden(session)
    if active_garden is not None:
        query = query.where(DecorationTable.garden_id == active_garden.id)
    rows = list(session.exec(query).all())
    return [_to_api_decoration(row) for row in rows]


@router.get("/{decoration_id}", response_model=Decoration)
def get_decoration(decoration_id: int, session: Session = Depends(get_session)) -> Decoration:  # type: ignore[valid-type]
    return _to_api_decoration(_get_or_404(session, decoration_id))


@router.post("", response_model=Decoration, status_code=201)
def create_decoration(
    decoration: _DecorationCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Decoration:  # type: ignore[valid-type]
    data = decoration.model_dump()
    # #266: resolve garden_id server-side against whichever garden is
    # currently active, but only when the client didn't supply one
    # explicitly (model_fields_set, not just "is it None") - same pattern as
    # create_bed (app/api/routes/beds.py).
    if "garden_id" not in decoration.model_fields_set:
        active_garden = get_active_garden(session)
        if active_garden is not None:
            data["garden_id"] = active_garden.id
    row = DecorationTable(**data)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return _to_api_decoration(row)


@router.patch("/{decoration_id}", response_model=Decoration)
def update_decoration(
    decoration_id: int, update: _DecorationUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Decoration:  # type: ignore[valid-type]
    decoration = _get_or_404(session, decoration_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(decoration, field, value)
    session.add(decoration)
    commit_or_409(session)
    session.refresh(decoration)
    return _to_api_decoration(decoration)


@router.delete("/{decoration_id}", status_code=204)
def delete_decoration(decoration_id: int, session: Session = Depends(get_session)) -> None:
    decoration = _get_or_404(session, decoration_id)
    session.delete(decoration)
    commit_or_409(session)
