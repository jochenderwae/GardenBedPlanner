"""Automatic Action (garden task) generation - #192.

Wires into the create endpoints for Bed/Planting/BedEquipment: creating one
of those (unless the caller is backfilling the garden's pre-existing
"initial state", in which case task generation is skipped entirely) also
creates the relevant follow-up Action row(s), templated off the plant's own
PlantPeriod data where it exists. Every function here only session.add()s
and session.flush()es - never commits; callers (the route handlers) already
call commit_or_409 for their own primary write, and task generation
piggybacks on that same commit rather than opening a second transaction.
"""

import calendar
from datetime import date

from sqlmodel import Session, select

from app.models.action import Action, ActionStatus, ActionType
from app.models.bed import Bed
from app.models.bed_equipment import BedEquipment
from app.models.plant import PlantPeriod
from app.models.planting import Planting

# Maps PlantPeriod.period_type codes onto the ActionType they generate.
# "thinning" has no per-species window in the data today (a real ETL gap,
# not modeled here) and stays a manually-created task; "clearing" doesn't
# need an entry at all since it collapses onto Planting.removed_date
# directly (see generate_clear_task below), not a species-level template.
_PERIOD_TYPE_TO_ACTION_TYPE: dict[str, ActionType] = {
    "sowing": ActionType.sow,
    "planting": ActionType.plant,
    "fertilizing": ActionType.fertilize,
    "harvesting": ActionType.harvest,
}


def _period_window(reference_year: int, start_month: int, end_month: int) -> tuple[date, date]:
    """First day of start_month through the last day of end_month, both in
    reference_year - except when end_month < start_month (the period wraps
    across a year boundary, e.g. a Nov-Feb overwintering window), in which
    case the end falls in reference_year + 1."""
    start = date(reference_year, start_month, 1)
    end_year = reference_year if end_month >= start_month else reference_year + 1
    last_day = calendar.monthrange(end_year, end_month)[1]
    end = date(end_year, end_month, last_day)
    return start, end


def _find_or_create_action(
    session: Session,
    *,
    action_type: ActionType,
    bed_id: int | None,
    plant_slug: str | None,
    due_date_start: date | None,
    due_date_end: date | None,
    equipment_id: int | None = None,
    depends_on_action_id: int | None = None,
) -> Action:
    """Get-or-create keyed on (action_type, bed_id, plant_slug,
    due_date_start, due_date_end) among still-pending actions - the
    mechanism behind "planting the same plant/date combination one-by-one
    groups into a single task, not one per plant" (#192): individual
    placements of the same plant, on the same bed, sharing the same
    planted_date all resolve to the exact same computed window, so they
    naturally collapse onto the same row here instead of creating a new one
    each time."""
    query = select(Action).where(
        Action.action_type == action_type,
        Action.bed_id == bed_id,
        Action.plant_slug == plant_slug,
        Action.due_date_start == due_date_start,
        Action.due_date_end == due_date_end,
        Action.status == ActionStatus.pending,
    )
    existing = session.exec(query).first()
    if existing is not None:
        return existing
    action = Action(
        action_type=action_type,
        bed_id=bed_id,
        plant_slug=plant_slug,
        due_date_start=due_date_start,
        due_date_end=due_date_end,
        equipment_id=equipment_id,
        depends_on_action_id=depends_on_action_id,
    )
    session.add(action)
    session.flush()
    return action


def generate_bed_tasks(session: Session, bed: Bed, *, is_initial_state: bool) -> Action | None:
    """A newly added bed gets a prepare_bed task. No species template
    applies here (no plant_slug yet) - due today, a same-day window."""
    if is_initial_state:
        return None
    today = date.today()
    return _find_or_create_action(
        session,
        action_type=ActionType.prepare_bed,
        bed_id=bed.id,
        plant_slug=None,
        due_date_start=today,
        due_date_end=today,
    )


def generate_equipment_tasks(
    session: Session, equipment: BedEquipment, *, is_initial_state: bool
) -> Action | None:
    """Placing equipment (created with a bed_id already assigned) gets an
    install_equipment task. Equipment created unassigned (bed_id is None -
    bought but sitting in inventory) has nothing to install yet, so no task
    is generated until it's actually assigned to a bed."""
    if is_initial_state or equipment.bed_id is None:
        return None
    today = date.today()
    return _find_or_create_action(
        session,
        action_type=ActionType.install_equipment,
        bed_id=equipment.bed_id,
        plant_slug=None,
        due_date_start=today,
        due_date_end=today,
        equipment_id=equipment.id,
    )


def _latest_prepare_bed_action(session: Session, bed_id: int | None) -> Action | None:
    if bed_id is None:
        return None
    query = (
        select(Action)
        .where(Action.bed_id == bed_id, Action.action_type == ActionType.prepare_bed)
        .order_by(Action.id.desc())
    )
    return session.exec(query).first()


def generate_planting_tasks(
    session: Session,
    planting: Planting,
    *,
    is_initial_state: bool,
    started_from_seed: bool,
) -> list[Action]:
    """One task per relevant lifecycle stage, templated off the plant's own
    PlantPeriod rows - sow/plant/fertilize/harvest. started_from_seed
    (indicated by the gardener at planting time, not a persisted column -
    see #192) decides whether the sow task applies at all: buying started
    plants skips the sowing step entirely, but the plant-out task still
    applies if that plant has a "planting" period. Clearing is handled
    separately by generate_clear_task, once removed_date is actually set -
    not here, since it isn't known at planting-creation time."""
    if is_initial_state:
        return []
    reference_year = (planting.planted_date or date.today()).year
    periods = session.exec(
        select(PlantPeriod).where(PlantPeriod.plant_slug == planting.plant_slug)
    ).all()
    prepare_bed_action = _latest_prepare_bed_action(session, planting.bed_id)
    created: list[Action] = []
    for period in periods:
        action_type = _PERIOD_TYPE_TO_ACTION_TYPE.get(period.period_type)
        if action_type is None:
            continue
        if action_type == ActionType.sow and not started_from_seed:
            continue
        start, end = _period_window(reference_year, period.start_month, period.end_month)
        depends_on = prepare_bed_action.id if action_type == ActionType.sow and prepare_bed_action else None
        action = _find_or_create_action(
            session,
            action_type=action_type,
            bed_id=planting.bed_id,
            plant_slug=planting.plant_slug,
            due_date_start=start,
            due_date_end=end,
            depends_on_action_id=depends_on,
        )
        created.append(action)
    return created


def generate_clear_task(
    session: Session, planting: Planting, *, is_initial_state: bool = False
) -> Action | None:
    """Clearing collapses the due-date window to a single day = the
    planting's own removed_date (per #180), not a species-level template -
    there's no PlantPeriod for "clearing"."""
    if is_initial_state or planting.removed_date is None:
        return None
    return _find_or_create_action(
        session,
        action_type=ActionType.clear,
        bed_id=planting.bed_id,
        plant_slug=planting.plant_slug,
        due_date_start=planting.removed_date,
        due_date_end=planting.removed_date,
    )
