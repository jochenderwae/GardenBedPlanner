from datetime import date
from enum import Enum

from sqlmodel import Field, SQLModel


class CompostBinFillState(str, Enum):
    empty = "empty"
    filling = "filling"
    full = "full"
    curing = "curing"


class CompostBin(SQLModel, table=True):
    """Compost-specific state for one of the garden's compost bins - fill
    state, last-turned date, estimated maturity - kept as a small satellite
    model linked 1:1 to a Bed rather than extending Bed itself, per this
    issue's (#39) own technical analysis: Bed.category is deliberately
    free-text/open-ended (see app/models/bed.py's own docstring on why),
    so compost-specific fields that only ever apply to one bed out of many
    belong on their own table, same reasoning as BedEquipment/
    CompostFertilizationLog being separate tables rather than Bed columns.

    bed_id is unique to enforce the 1:1 relationship - a second CompostBin
    for the same bed_id fails as a 409 (unique violation) via the shared
    commit_or_409 pattern, not a silent second row.

    estimated_maturity_date is a plain gardener-set field, not derived from
    last_turned_date - there's no single reliable formula (compost maturity
    depends on turn frequency, greens/browns ratio, weather, bin size) to
    compute it from turn history alone; the gardener sets/updates their own
    estimate as they inspect the pile, same "record what's observed, don't
    invent a formula" spirit as HarvestLog's yield_amount/yield_unit."""

    __tablename__ = "compost_bin"

    id: int | None = Field(default=None, primary_key=True)
    bed_id: int = Field(foreign_key="bed.id", unique=True)
    fill_state: CompostBinFillState = CompostBinFillState.empty
    last_turned_date: date | None = None
    estimated_maturity_date: date | None = None
    notes: str = ""
