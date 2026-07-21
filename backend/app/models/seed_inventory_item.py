from datetime import date

from sqlmodel import Field, SQLModel


class SeedInventoryItem(SQLModel, table=True):
    """Seed stock on hand for a plant - matches docs/schema.md's
    SEED_INVENTORY_ITEM sketch. quantity_seeds/weight_grams are both
    nullable (rather than one required column) since seed packets are sold
    both by count and by weight - a given item records whichever the
    packet/purchase actually specifies, not both. Foundational for the
    seed buying guide/agenda view (#41)."""

    __tablename__ = "seed_inventory_item"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    quantity_seeds: float | None = None
    weight_grams: float | None = None
    acquired_date: date | None = None
    notes: str = ""
