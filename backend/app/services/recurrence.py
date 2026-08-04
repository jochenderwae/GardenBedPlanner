"""#226: manually-created recurring/repeating tasks - generates the next
occurrence of a recurring Action once the current one is marked completed
or skipped (see app/api/routes/actions.py's update_action, which calls
`generate_next_occurrence` synchronously on that status transition - chosen
over a scheduled-job approach for determinism/simpler testing, per the
ticket's own note that either implementation satisfies the required
semantic).
"""

import calendar
from datetime import date, timedelta

from sqlmodel import Session

from app.models.action import Action, ActionStatus, RecurrenceUnit


def _add_months(d: date, months: int) -> date:
    """Calendar-correct month arithmetic (handles month-end clamping, e.g.
    Jan 31 + 1 month -> Feb 28/29) - stdlib `calendar`, no new dependency
    for what's otherwise a one-function need (no `python-dateutil` in this
    project's dependencies today)."""
    total_month_index = d.month - 1 + months
    year = d.year + total_month_index // 12
    month = total_month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def shift_date(d: date, unit: RecurrenceUnit, interval: int) -> date:
    """`d` shifted forward by `interval` units of `unit` - "every N
    days/weeks/months/years"."""
    if unit == RecurrenceUnit.daily:
        return d + timedelta(days=interval)
    if unit == RecurrenceUnit.weekly:
        return d + timedelta(weeks=interval)
    if unit == RecurrenceUnit.monthly:
        return _add_months(d, interval)
    if unit == RecurrenceUnit.yearly:
        return _add_months(d, interval * 12)
    raise ValueError(f"Unknown recurrence unit: {unit}")  # pragma: no cover - exhaustive enum


def generate_next_occurrence(session: Session, completed_action: Action) -> Action | None:
    """Called after `completed_action` has just transitioned to completed
    or skipped (see update_action) - creates and adds (not commits, same
    "caller owns the transaction" convention every other service function
    in this codebase follows) the next occurrence if `completed_action` is
    recurring and hasn't run past its own `recurrence_end_date`. Returns
    None (a no-op) when `completed_action` isn't recurring at all, or when
    the next occurrence's computed due window would fall after
    `recurrence_end_date`.

    A skipped occurrence still generates the next one - a skipped chore
    isn't a cancelled recurrence, only `recurrence_end_date` (or the
    absence of a recurrence_unit at all) stops generation."""
    if completed_action.recurrence_unit is None:
        return None

    next_due_start = (
        shift_date(completed_action.due_date_start, completed_action.recurrence_unit, completed_action.recurrence_interval)
        if completed_action.due_date_start is not None
        else None
    )
    next_due_end = (
        shift_date(completed_action.due_date_end, completed_action.recurrence_unit, completed_action.recurrence_interval)
        if completed_action.due_date_end is not None
        else None
    )

    if completed_action.recurrence_end_date is not None:
        # due_date_end is the primary "due" marker elsewhere in this
        # codebase (app/services/reminders.py's due_actions filters on it,
        # not due_date_start) - fall back to due_date_start only when no
        # due_date_end exists at all.
        next_window_reference = next_due_end if next_due_end is not None else next_due_start
        if next_window_reference is not None and next_window_reference > completed_action.recurrence_end_date:
            return None

    next_occurrence = Action(
        action_type=completed_action.action_type,
        due_date_start=next_due_start,
        due_date_end=next_due_end,
        status=ActionStatus.pending,
        bed_id=completed_action.bed_id,
        plant_slug=completed_action.plant_slug,
        equipment_id=completed_action.equipment_id,
        notes=completed_action.notes,
        recurrence_unit=completed_action.recurrence_unit,
        recurrence_interval=completed_action.recurrence_interval,
        recurrence_end_date=completed_action.recurrence_end_date,
        recurrence_source_action_id=completed_action.id,
    )
    session.add(next_occurrence)
    return next_occurrence
