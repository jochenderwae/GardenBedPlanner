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
    REMINDER_LOOKAHEAD_DAYS. Actions with no due_date at all are never
    "due" for reminder purposes (nothing to compare against), and
    completed/skipped actions are excluded outright - status is what stops
    the reminders, not a one-time notified flag."""
    if as_of is None:
        as_of = date.today()
    cutoff = as_of + timedelta(days=REMINDER_LOOKAHEAD_DAYS)
    return list(
        session.exec(
            select(Action)
            .where(Action.status == ActionStatus.pending)
            .where(Action.due_date.is_not(None))
            .where(Action.due_date <= cutoff)
        ).all()
    )


def _notification_payload(action: Action) -> str:
    label = action.action_type.value.replace("_", " ").capitalize()
    body = f"{label} due {action.due_date.isoformat()}" if action.due_date else label
    return json.dumps({"title": "GardenBedPlanner reminder", "body": body})


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
    try:
        actions = due_actions(session, as_of)
        if not actions:
            return 0
        subscriptions = list(session.exec(select(PushSubscription)).all())
        if not subscriptions:
            return 0

        sent = 0
        for action in actions:
            payload = _notification_payload(action)
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
