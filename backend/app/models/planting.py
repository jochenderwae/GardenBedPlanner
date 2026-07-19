from datetime import date
from enum import Enum

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class PlacementType(str, Enum):
    individual = "individual"
    row = "row"
    field = "field"


class Planting(SQLModel, table=True):
    """A plant placed somewhere - inside a raised planter or directly in the
    ground, doesn't matter which: bed_id always points at *some* Bed (the
    ground itself is just an ordinary Bed auto-created alongside the Garden,
    see app/api/routes/garden.py), so geometry is always unambiguously
    bed-local coordinates, never garden-space."""

    id: int | None = Field(default=None, primary_key=True)
    bed_id: int = Field(foreign_key="bed.id")
    plant_slug: str = Field(foreign_key="plant.slug")
    placement_type: PlacementType = PlacementType.individual
    # jsonb rectangle|polygon, bed-local - see app/models/geometry.py.
    geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    planted_date: date | None = None
    removed_date: date | None = None
