"""Reminder/agenda scheduled job (#48) - periodically checks for due
Action rows (see app/models/action.py's own docstring: "Foundational for
the reminder/agenda scheduled job (#48, checks due_date)") and sends a Web
Push notification (app/services/push.py) for each one to every registered
PushSubscription.

Runs against its own Session (app/core/db.engine), not FastAPI's
get_session dependency - an APScheduler job runs outside any HTTP request,
so there's no request-scoped session to inject.

No "already notified" bookkeeping: a still-pending action gets reminded
about again on every job run (deliberately - it's still not done), and
only stops once its status is no longer `pending` (completed/skipped),
which the query below filters on directly rather than tracking separately.
"""

import json
import logging
from datetime import date, timedelta

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.db import engine
from app.models.action import Action, ActionStatus
from app.models.push_subscription import PushSubscription
from app.services.push import PushNotConfiguredError, send_push_notification

logger = logging.getLogger(__name__)

# How often the scheduled job runs. Deliberately not hourly-or-more-often:
# there's no per-action "already notified" dedup (see module docstring), so
# a shorter interval would re-send the same reminder that often until the
# action is completed - once a day is a reasonable digest cadence instead.
# No UX reference dictates this exact figure (same caveat as rotation.py's
# DEFAULT_LOOKBACK_DAYS) - not user-configurable yet.
REMINDER_CHECK_INTERVAL_HOURS = 24

# How far ahead of an action's due_date to start reminding about it, not
# just the day it's actually due - "upcoming actions", per the issue's own
# functional requirement, not only overdue ones. Same tuning caveat as
# REMINDER_CHECK_INTERVAL_HOURS above.
REMINDER_LOOKAHEAD_DAYS = 3


def due_actions(session: Session, as_of: date | None = None) -> list[Action]:
    """Pending actions due today, overdue, or due within
    REMINDER_LOOKAHEAD_DAYS - "due" meaning the window's finish-before date
    (due_date_end, #192), not its start. Actions with no due_date_end at
    all are never "due" for reminder purposes (nothing to compare
    against), and completed/skipped actions are excluded outright - status
    is what stops the reminders, not a one-time notified flag.

    #230: an action snoozed_until a date still in the future (relative to
    `as_of`) is excluded from the digest too - "remind me later" suppresses
    the push without touching due_date_start/due_date_end at all. Once
    snoozed_until has passed (<= as_of), the action reappears automatically
    on the next run - no separate "unsnooze" step exists or is needed."""
    if as_of is None:
        as_of = date.today()
    cutoff = as_of + timedelta(days=REMINDER_LOOKAHEAD_DAYS)
    return list(
        session.exec(
            select(Action)
            .where(Action.status == ActionStatus.pending)
            .where(Action.due_date_end.is_not(None))
            .where(Action.due_date_end <= cutoff)
            .where(or_(Action.snoozed_until.is_(None), Action.snoozed_until <= as_of))
        ).all()
    )


def next_saturday(as_of: date) -> date:
    """The upcoming Saturday strictly after `as_of` - Dave's own "remind me
    this weekend" framing (product-owner/research/user-journeys-dave.md)
    is the default snooze target both the push notification's action
    button (see `_notification_payload`) and the dedicated snooze endpoint
    (app/api/routes/actions.py's snooze_action, when called with no
    explicit `until`) fall back to. Strictly after, not "today if today is
    already Saturday" - snoozing to the current day would be a no-op (the
    action would immediately count as due again on the very next check)."""
    days_until_saturday = (5 - as_of.weekday()) % 7  # Monday=0 ... Saturday=5
    if days_until_saturday == 0:
        days_until_saturday = 7
    return as_of + timedelta(days=days_until_saturday)


def _notification_payload(action: Action, as_of: date) -> str:
    label = action.action_type.value.replace("_", " ").capitalize()
    body = f"{label} due by {action.due_date_end.isoformat()}" if action.due_date_end else label
    snooze_target = next_saturday(as_of)
    # #230: a Web Push action button (the `actions` array in the payload
    # `showNotification()` options - Push API spec) - `action: "snooze"` is
    # the id the service worker's own `notificationclick` handler
    # distinguishes from a plain tap-to-open (frontend/#231's scope, not
    # built here). `data.actionId`/`data.snoozeUntil` give that handler
    # everything it needs to call POST /api/actions/{id}/snooze without
    # having to re-derive the snooze date itself.
    return json.dumps(
        {
            "title": "GardenBedPlanner reminder",
            "body": body,
            "data": {"actionId": action.id, "snoozeUntil": snooze_target.isoformat()},
            "actions": [{"action": "snooze", "title": f"Snooze until Saturday ({snooze_target.isoformat()})"}],
        }
    )


def send_due_action_reminders(session: Session | None = None, as_of: date | None = None) -> int:
    """Sends one push notification per due action (see `due_actions`), to
    every registered subscription. Returns the number of (action,
    subscription) sends that actually succeeded - useful for logging and
    for tests, not required by any caller. Safe to call with no due
    actions, no registered subscriptions, or VAPID unconfigured - all
    three are "nothing (more) to send", not errors that should crash the
    scheduler's job loop."""
    owns_session = session is None
    if session is None:
        session = Session(engine)
    if as_of is None:
        as_of = date.today()
    try:
        actions = due_actions(session, as_of)
        if not actions:
            return 0
        subscriptions = list(session.exec(select(PushSubscription)).all())
        if not subscriptions:
            return 0

        sent = 0
        for action in actions:
            payload = _notification_payload(action, as_of)
            for subscription in subscriptions:
                try:
                    if send_push_notification(session, subscription, payload):
                        sent += 1
                except PushNotConfiguredError:
                    logger.info("Skipping due-action reminders - VAPID keys not configured yet")
                    return sent
        return sent
    finally:
        if owns_session:
            session.close()
