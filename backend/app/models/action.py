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
    # No per-species window exists for thinning in the data today (a real
    # ETL gap, not modeled here - see #192's technical analysis) - stays a
    # manually-created task type, never auto-generated.
    thin = "thin"


class ActionStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    skipped = "skipped"


class RecurrenceUnit(str, Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    yearly = "yearly"


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
    # A due *window*, not a single instant (#192): due_date_start = the
    # first day of the matching PlantPeriod.start_month ("can't start
    # before"), due_date_end = the last day of that same period's
    # end_month ("must finish before") - "what can I pick up right now" is
    # due_date_start <= today, ordered by due_date_end ascending (closest
    # deadline first). A clearing task collapses this to a single day
    # (due_date_start == due_date_end == Planting.removed_date) since
    # clearing isn't templated off species data. completed_date (below)
    # records the separate, actual completion event - independent of this
    # window, never derived from it.
    due_date_start: date | None = None
    due_date_end: date | None = None
    completed_date: date | None = None
    status: ActionStatus = ActionStatus.pending
    garden_plan_entry_id: int | None = Field(default=None, foreign_key="garden_plan_entry.id")
    bed_id: int | None = Field(default=None, foreign_key="bed.id")
    plant_slug: str | None = Field(default=None, foreign_key="plant.slug")
    equipment_id: int | None = Field(default=None, foreign_key="bed_equipment.id")
    # Lightweight dependency - e.g. sowing shouldn't start before bed prep
    # is done. A single optional predecessor, not a general DAG - matches
    # the ticket's own "keep this lightweight" instruction rather than
    # building full project-management scheduling.
    depends_on_action_id: int | None = Field(default=None, foreign_key="action.id")
    notes: str = ""
    # #230: "remind me later" - suppresses further reminder pushes
    # (app/services/reminders.py's due_actions) until this date, without
    # touching due_date_start/due_date_end (the task's actual due window)
    # at all. Set and in the future relative to the day the reminder job
    # runs -> excluded from that day's digest; once it's passed, the
    # action reappears automatically, no separate "unsnooze" step. Doesn't
    # interact with actionable_now (#192) either - snoozing only affects
    # the reminder push, never the task's own due window/urgency ordering.
    snoozed_until: date | None = None
    # #226: manually-created recurring/repeating tasks (e.g. "turn the
    # compost bin every 3 weeks") - None (the default, and the only state
    # for every existing/#192-auto-generated row) means not recurring.
    # Only meaningful in combination: recurrence_interval/recurrence_end_date
    # are inert unless recurrence_unit is also set. Only a manually-created
    # Action (no garden_plan_entry_id tie) is expected to use these in
    # practice, but nothing at the API layer enforces that - see this
    # ticket's own note on why not.
    recurrence_unit: RecurrenceUnit | None = None
    # "every N units" (every 1 week, every 3 months, ...).
    recurrence_interval: int = 1
    # Stop generating new occurrences once this date is passed - None means
    # open-ended (recurs forever).
    recurrence_end_date: date | None = None
    # Links a generated occurrence back to the action it was generated
    # from (app/api/routes/actions.py's update_action, on completion) -
    # self-FK to Action, same precedent depends_on_action_id already
    # established, but a distinct field/relationship: recurrence chaining,
    # not dependency ordering, the two are never conflated.
    recurrence_source_action_id: int | None = Field(default=None, foreign_key="action.id")
