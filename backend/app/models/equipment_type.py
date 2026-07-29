from enum import Enum

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class EquipmentCategory(str, Enum):
    bed_bound = "bed_bound"
    garden_bound_decorative = "garden_bound_decorative"
    garden_bound_functional = "garden_bound_functional"


class EquipmentType(SQLModel, table=True):
    """Reference lookup for BedEquipment.equipment_type's real-world default
    shape and bed-bound vs. garden-bound categorization (#207, seeded from
    #206's researched data/equipment_types.json via
    app/scripts/import_equipment_types.py, same pattern as Plant).

    slug is deliberately not a hard FK target for
    BedEquipment.equipment_type - that column stays free text (see that
    model's own docstring), matched against this table's slug by string at
    read/render time, not joined. An exotic/one-off equipment_type with no
    matching row here still works, just without a rendered default - the
    frontend falls back to its existing fixed box in that case."""

    __tablename__ = "equipment_type"

    id: int | None = Field(default=None, primary_key=True)
    slug: str = Field(unique=True, index=True)
    name: str
    category: EquipmentCategory
    # jsonb rectangle|polygon template (x/y left at the origin - actual
    # placement position is per-instance, not part of a type's default) -
    # see app/models/geometry.py. Not nullable: every EquipmentType row
    # this table holds is expected to carry a real researched default: an
    # equipment_type string with no matching EquipmentType row at all (not
    # a row with a null geometry) is how "no rendered default" is expressed.
    default_geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    default_height_cm: float | None = None
