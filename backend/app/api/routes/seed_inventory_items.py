from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.seed_inventory_item import SeedInventoryItem as SeedInventoryItemTable

router = APIRouter(prefix="/seed-inventory-items", tags=["seed-inventory-items"])

_FIELDS = {name: field for name, field in SeedInventoryItemTable.model_fields.items()}


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_SeedInventoryItemCreate = create_model(
    "SeedInventoryItemCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _FIELDS.items() if name != "id"},
)

_SeedInventoryItemUpdate = create_model(
    "SeedInventoryItemUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, item_id: int) -> SeedInventoryItemTable:
    item = session.get(SeedInventoryItemTable, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No seed inventory item with id {item_id}")
    return item


@router.get("", response_model=list[SeedInventoryItemTable])
def list_seed_inventory_items(
    plant_slug: str | None = Query(default=None, description="Only items for this plant"),
    session: Session = Depends(get_session),
) -> list[SeedInventoryItemTable]:
    query = select(SeedInventoryItemTable)
    if plant_slug is not None:
        query = query.where(SeedInventoryItemTable.plant_slug == plant_slug)
    return list(session.exec(query).all())


@router.get("/{item_id}", response_model=SeedInventoryItemTable)
def get_seed_inventory_item(
    item_id: int, session: Session = Depends(get_session)
) -> SeedInventoryItemTable:
    return _get_or_404(session, item_id)


@router.post("", response_model=SeedInventoryItemTable, status_code=201)
def create_seed_inventory_item(
    item: _SeedInventoryItemCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> SeedInventoryItemTable:
    row = SeedInventoryItemTable(**item.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{item_id}", response_model=SeedInventoryItemTable)
def update_seed_inventory_item(
    item_id: int,
    update: _SeedInventoryItemUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> SeedInventoryItemTable:
    item = _get_or_404(session, item_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_seed_inventory_item(item_id: int, session: Session = Depends(get_session)) -> None:
    item = _get_or_404(session, item_id)
    session.delete(item)
    commit_or_409(session)
