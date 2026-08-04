from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.resource_pack import ResourcePack as ResourcePackTable

router = APIRouter(prefix="/resource-packs", tags=["resource-packs"])

_PACK_FIELDS = {name: field for name, field in ResourcePackTable.model_fields.items()}


def _field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_ResourcePackCreate = create_model(
    "ResourcePackCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _PACK_FIELDS.items() if name != "id"},
)

_ResourcePackUpdate = create_model(
    "ResourcePackUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _PACK_FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, pack_id: int) -> ResourcePackTable:
    pack = session.get(ResourcePackTable, pack_id)
    if pack is None:
        raise HTTPException(status_code=404, detail=f"No resource pack with id {pack_id}")
    return pack


@router.get("", response_model=list[ResourcePackTable])
def list_resource_packs(session: Session = Depends(get_session)) -> list[ResourcePackTable]:
    return list(session.exec(select(ResourcePackTable)).all())


@router.get("/{pack_id}", response_model=ResourcePackTable)
def get_resource_pack(pack_id: int, session: Session = Depends(get_session)) -> ResourcePackTable:
    return _get_or_404(session, pack_id)


@router.post("", response_model=ResourcePackTable, status_code=201)
def create_resource_pack(
    pack: _ResourcePackCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> ResourcePackTable:
    row = ResourcePackTable(**pack.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{pack_id}", response_model=ResourcePackTable)
def update_resource_pack(
    pack_id: int, update: _ResourcePackUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> ResourcePackTable:
    pack = _get_or_404(session, pack_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(pack, field, value)
    session.add(pack)
    commit_or_409(session)
    session.refresh(pack)
    return pack


@router.delete("/{pack_id}", status_code=204)
def delete_resource_pack(pack_id: int, session: Session = Depends(get_session)) -> None:
    # Part types belonging to this pack have a hard FK (resource_pack_id) -
    # deleting a non-empty pack surfaces a 409 via commit_or_409 rather than
    # silently orphaning/cascading, same "no cascade without a real need"
    # precedent as Garden's own docstring.
    pack = _get_or_404(session, pack_id)
    session.delete(pack)
    commit_or_409(session)
