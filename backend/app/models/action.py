from datetime import date
from enum import Enum

from sqlmodel import Field, SQLModel


class ActionType(str, Enum):
    fertilize = "fertilize"
    compost = "compost"
    prepare_bed = "prepare_bed"
    sow = "sow"
    plant = "plant"
    install_equipment = "install_equipment"
    remove_equipment = "remove_equipment"
    harvest = "harvest"
    clear = "clear"
    collect_seeds = "collect_seeds"


class ActionStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    skipped = "skipped"


class Action(SQLModel, table=True):
    """A generic garden work item - fertilize, compost, sow, plant, harvest,
    etc. - so work can be tracked/reminded about regardless of which area it
    belongs to. Foundational for the reminder/agenda scheduled job (#48,
    checks due_date) and the future calendar view (#29).

    Four nullable FKs (garden_plan_entry/bed/plant/equipment) rather than a
    polymorphic target_type/target_id pair - matches docs/schema.md's own
    "Modeling decisions worth revisiting" note on this table: simplest for
    SQLModel/Alembic, at the cost of getting sparse; a generic pair is the
    documented alternative if nullable-FK sprawl becomes a real problem.
    None of them are mutually exclusive or required - a general compost turn
    with no bed/plant/equipment reference at all is a legitimate action."""

    id: int | None = Field(default=None, primary_key=True)
    action_type: ActionType
    due_date: date | None = None
    completed_date: date | None = None
    status: ActionStatus = ActionStatus.pending
    garden_plan_entry_id: int | None = Field(default=None, foreign_key="garden_plan_entry.id")
    bed_id: int | None = Field(default=None, foreign_key="bed.id")
    plant_slug: str | None = Field(default=None, foreign_key="plant.slug")
    equipment_id: int | None = Field(default=None, foreign_key="bed_equipment.id")
    notes: str = ""
