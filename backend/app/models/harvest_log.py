from datetime import date
from enum import Enum

from sqlmodel import Field, SQLModel


class HarvestQuality(str, Enum):
    poor = "poor"
    fair = "fair"
    good = "good"
    excellent = "excellent"


class HarvestLog(SQLModel, table=True):
    """A logged harvest (yield/quality/notes) against a specific Planting -
    per root CLAUDE.md's domain note that harvest logs should inform next
    year's planning. Linked via planting_id rather than bed_id: the point
    is to build a per-crop yield history (this variety of tomato in this
    bed did/didn't do well), which a bare bed_id link would lose once
    multiple plantings have occupied the same bed over time.

    No HARVEST_LOG table exists yet in docs/schema.md (unlike
    COMPOST_FERTILIZATION_LOG) - this shape is designed here following that
    table's own pattern (a log row referencing what it's about, a date, and
    free-text notes) plus Planting's yield-adjacent fields. yield_amount/
    yield_unit are a free-text-unit pair (kg, count, bunches, ...) rather
    than a fixed unit column, same reasoning as BedEquipment.equipment_type/
    Bed.category: real produce is measured too many different ways (weight
    for tomatoes, count for peppers, bunches for herbs) to force one unit."""

    __tablename__ = "harvest_log"

    id: int | None = Field(default=None, primary_key=True)
    planting_id: int = Field(foreign_key="planting.id")
    harvest_date: date
    yield_amount: float | None = None
    yield_unit: str | None = None
    quality: HarvestQuality | None = None
    notes: str = ""
