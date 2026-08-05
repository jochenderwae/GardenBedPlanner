from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from app.api.deps import active_garden_bed_ids, get_active_garden
from app.core.db import get_session
from app.models.bed_equipment import BedEquipment as BedEquipmentTable
from app.models.equipment_type import EquipmentType as EquipmentTypeTable
from app.models.irrigation_part import IrrigationPart as IrrigationPartTable
from app.models.irrigation_part_instance import IrrigationPartInstance as IrrigationPartInstanceTable
from app.models.irrigation_part_type import IrrigationPartType as IrrigationPartTypeTable

router = APIRouter(prefix="/shopping-list", tags=["shopping-list"])


class ShoppingListItem(BaseModel):
    """One aggregated shortfall - #255's generalization of the "needs
    purchase" concept that already existed per-part
    (app/api/routes/irrigation_parts.py's IrrigationPartDetail) into a
    single cross-cutting view that also covers BedEquipment. category
    distinguishes what's being aggregated (never mixed into one row) since
    the two sources have different identity/grouping keys underneath -
    irrigation parts are per-IrrigationPart-row (source_id is that row's
    id), bed equipment is per-equipment_type string (source_id is None,
    there's no single row to point at once several unowned rows of the same
    type are grouped together). name/part_number/notes come from the
    matching catalog row (IrrigationPartType/EquipmentType) when one
    exists, same "seeded lookup, matched by string, falls back gracefully
    when absent" precedent those two tables already establish - falls back
    to the raw type string when it doesn't."""

    category: str
    source_id: int | None
    type_key: str
    name: str
    part_number: str | None
    quantity_needed: int
    notes: str


def _irrigation_shortfalls(session: Session) -> list[ShoppingListItem]:
    """Mirrors IrrigationPartDetail's own needs_purchase/instance_count
    derivation (irrigation_parts.py) rather than reimplementing it
    differently here - same shortfall definition, just aggregated into the
    shopping list shape instead of returned per-part. Not garden-scoped:
    IrrigationPart itself carries no garden_id (see that model's own
    docstring), same as its own list route."""
    parts = list(session.exec(select(IrrigationPartTable)).all())
    part_types_by_slug = {row.slug: row for row in session.exec(select(IrrigationPartTypeTable)).all()}
    items: list[ShoppingListItem] = []
    for part in parts:
        instance_count = len(
            session.exec(
                select(IrrigationPartInstanceTable).where(IrrigationPartInstanceTable.part_id == part.id)
            ).all()
        )
        shortfall = instance_count - part.quantity_on_hand
        if shortfall <= 0:
            continue
        part_type = part_types_by_slug.get(part.part_type)
        items.append(
            ShoppingListItem(
                category="irrigation_part",
                source_id=part.id,
                type_key=part.part_type,
                name=part.name,
                part_number=part_type.part_number if part_type is not None else None,
                quantity_needed=shortfall,
                notes=part.notes,
            )
        )
    return items


def _equipment_shortfalls(session: Session) -> list[ShoppingListItem]:
    """BedEquipment has no quantity_on_hand aggregate (each row is one
    physical item, see that model's own docstring) - #255 expresses a
    shortfall as owned=False rows instead, grouped by equipment_type since
    several unowned rows of the same type are one shopping-list line, not
    several. Scoped to the active garden the same way bed_equipment.py's
    own list route is - an unowned "planned" row is always attached to a
    bed_id/garden_id (there's nowhere else it would make sense to place a
    thing you don't own yet), so unlike that route's own unplaced-inventory
    branch there's no "both null always shows" case to preserve here."""
    query = select(BedEquipmentTable).where(BedEquipmentTable.owned == False)  # noqa: E712
    active_garden = get_active_garden(session)
    if active_garden is not None:
        bed_ids = active_garden_bed_ids(session, active_garden=active_garden) or []
        query = query.where(
            or_(
                BedEquipmentTable.garden_id == active_garden.id,
                BedEquipmentTable.bed_id.in_(bed_ids),
            )
        )
    rows = list(session.exec(query).all())
    equipment_types_by_slug = {row.slug: row for row in session.exec(select(EquipmentTypeTable)).all()}

    counts: dict[str, int] = {}
    for row in rows:
        counts[row.equipment_type] = counts.get(row.equipment_type, 0) + 1

    items: list[ShoppingListItem] = []
    for equipment_type, quantity_needed in counts.items():
        catalog = equipment_types_by_slug.get(equipment_type)
        items.append(
            ShoppingListItem(
                category="equipment",
                source_id=None,
                type_key=equipment_type,
                name=catalog.name if catalog is not None else equipment_type,
                part_number=None,
                quantity_needed=quantity_needed,
                notes="",
            )
        )
    return items


@router.get("", response_model=list[ShoppingListItem])
def get_shopping_list(session: Session = Depends(get_session)) -> list[ShoppingListItem]:
    """Every current "needs purchase" shortfall across irrigation parts and
    bed equipment, one list - #255's own point being that this is a single
    view, not two separate ones per source."""
    return _irrigation_shortfalls(session) + _equipment_shortfalls(session)
