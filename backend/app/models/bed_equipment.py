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
    # Open-ended (trellis | drip_line | stake | cold_frame | ...), same
    # free-text-not-enum reasoning as Bed.category.
    equipment_type: str
    # jsonb rectangle|polygon, bed-local - see app/models/geometry.py. Null
    # while unassigned/in inventory.
    geometry: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    height_cm: float | None = None
    water_delivery_lph: float | None = None
