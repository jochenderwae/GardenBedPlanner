from enum import Enum

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class EquipmentCondition(str, Enum):
    good = "good"
    damaged = "damaged"
    retired = "retired"


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
    # #225: what happened to this item when it was last unplaced from a bed
    # - "returned to usable inventory" (good, the default) vs. "broken,
    # don't silently offer it as available stock again" (damaged/retired).
    # Independent of bed_id/garden_id being null - unplacing on its own
    # never implied "unusable" before this field existed, and still
    # doesn't by default; the gardener sets condition explicitly when it's
    # actually damaged/retired, same "record what's observed" spirit as
    # CompostBin.estimated_maturity_date.
    condition: EquipmentCondition = EquipmentCondition.good
    # #255: lets a piece of equipment be placed (bed_id/garden_id + geometry
    # set) before it's actually been bought - same "place beyond what you
    # own, let a shopping list surface the gap" allowance #254 already gives
    # IrrigationPart/IrrigationPartInstance (quantity_on_hand vs.
    # instance_count), adapted to BedEquipment's "one row per physical
    # item" shape rather than a stock-count column: owned=False means "this
    # row is a plan to place one, not a physical item I have yet". Defaults
    # True so every pre-existing row (all of which represent equipment
    # that's actually in hand) keeps meaning exactly what it always did.
    # See app/api/routes/shopping_list.py for how this is aggregated into
    # the shopping list.
    owned: bool = True
