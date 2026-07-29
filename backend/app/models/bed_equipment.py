from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class BedEquipment(SQLModel, table=True):
    """Trellises, drip lines, stakes, cold frames, etc. bed_id is nullable -
    unlike Planting (always bed-local), equipment can sit unassigned in
    inventory (bought but not placed yet), in which case geometry is also
    null - there's nowhere to draw it until it's assigned to a bed."""

    __tablename__ = "bed_equipment"

    id: int | None = Field(default=None, primary_key=True)
    bed_id: int | None = Field(default=None, foreign_key="bed.id")
    # Garden-bound placement (#207) - a rain barrel, compost bin, pathway,
    # etc. that belongs to the garden as a whole rather than to one bed.
    # Mutually exclusive with bed_id, enforced at the API layer
    # (app/api/routes/bed_equipment.py), not a DB check constraint - both
    # null still means unplaced inventory, same as today. Garden is
    # effectively a singleton today (see app/models/garden.py's own
    # docstring), so this will almost always point at the one existing row
    # in practice, but a real FK keeps the schema honest for whenever
    # multi-garden support actually happens.
    garden_id: int | None = Field(default=None, foreign_key="garden.id")
    # Open-ended (trellis | drip_line | stake | cold_frame | ...), same
    # free-text-not-enum reasoning as Bed.category.
    equipment_type: str
    # jsonb rectangle|polygon, bed-local - see app/models/geometry.py. Null
    # while unassigned/in inventory.
    geometry: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    height_cm: float | None = None
    water_delivery_lph: float | None = None
    # Drip irrigation zone grouping (#36) - which shared water source/valve
    # this equipment belongs to, if any. Nullable: most equipment
    # (trellises, stakes, cold frames) never belongs to a zone, and even
    # drip lines/emitters can exist unzoned (placed but not yet wired into a
    # planned watering circuit). See app/models/irrigation_zone.py.
    zone_id: int | None = Field(default=None, foreign_key="irrigation_zone.id")
