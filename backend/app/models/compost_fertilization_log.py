from datetime import date
from enum import Enum

from sqlmodel import Field, SQLModel


class CompostFertilizationLogType(str, Enum):
    compost = "compost"
    fertilizer = "fertilizer"


class CompostFertilizationLog(SQLModel, table=True):
    """A logged compost/fertilization event against a specific Bed - what
    was applied, when, and how much - per root CLAUDE.md's domain note that
    compost/fertilization logs should be linkable to specific beds so
    nutrient history informs next season's crop assignment. Shape matches
    docs/schema.md's COMPOST_FERTILIZATION_LOG table (already sketched
    there, unlike HarvestLog which had no prior table and was designed from
    scratch - see app/models/harvest_log.py).

    amount is a free-text field (not a fixed numeric+unit pair) - compost
    applications ("2 wheelbarrows", "a 5cm layer") don't reduce to a single
    numeric unit the way HarvestLog's yield_amount/yield_unit pair does for
    produce; forcing structure here would lose information rather than
    normalize it."""

    __tablename__ = "compost_fertilization_log"

    id: int | None = Field(default=None, primary_key=True)
    bed_id: int = Field(foreign_key="bed.id")
    log_date: date
    type: CompostFertilizationLogType
    product: str = ""
    amount: str = ""
    notes: str = ""
