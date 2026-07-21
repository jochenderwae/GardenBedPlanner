"""Reminder/agenda scheduled job (see app/services/reminders.py,
app/core/scheduler.py) - due_actions() filtering and
send_due_action_reminders()'s graceful no-crash behavior."""

from datetime import date, timedelta

import pytest

from app.models.action import Action, ActionStatus, ActionType
from app.models.push_subscription import PushSubscription
from app.services.reminders import REMINDER_LOOKAHEAD_DAYS, due_actions, send_due_action_reminders

pytestmark = pytest.mark.integration

TODAY = date(2027, 6, 15)


def _action(db_session, due_date: date | None, status: ActionStatus = ActionStatus.pending) -> Action:
    action = Action(action_type=ActionType.sow, due_date=due_date, status=status)
    db_session.add(action)
    db_session.commit()
    db_session.refresh(action)
    return action


def test_due_actions_includes_overdue_and_due_today(db_session) -> None:
    overdue = _action(db_session, TODAY - timedelta(days=5))
    due_today = _action(db_session, TODAY)

    result = due_actions(db_session, as_of=TODAY)
    ids = {a.id for a in result}
    assert overdue.id in ids
    assert due_today.id in ids


def test_due_actions_includes_upcoming_within_lookahead(db_session) -> None:
    upcoming = _action(db_session, TODAY + timedelta(days=REMINDER_LOOKAHEAD_DAYS))

    result = due_actions(db_session, as_of=TODAY)
    assert upcoming.id in {a.id for a in result}


def test_due_actions_excludes_far_future(db_session) -> None:
    far_future = _action(db_session, TODAY + timedelta(days=REMINDER_LOOKAHEAD_DAYS + 1))

    result = due_actions(db_session, as_of=TODAY)
    assert far_future.id not in {a.id for a in result}


def test_due_actions_excludes_no_due_date(db_session) -> None:
    no_due_date = _action(db_session, None)

    result = due_actions(db_session, as_of=TODAY)
    assert no_due_date.id not in {a.id for a in result}


def test_due_actions_excludes_completed(db_session) -> None:
    completed = _action(db_session, TODAY - timedelta(days=1), status=ActionStatus.completed)
    skipped = _action(db_session, TODAY - timedelta(days=1), status=ActionStatus.skipped)

    result = due_actions(db_session, as_of=TODAY)
    ids = {a.id for a in result}
    assert completed.id not in ids
    assert skipped.id not in ids


def test_send_due_action_reminders_no_due_actions_is_a_noop(db_session) -> None:
    assert send_due_action_reminders(db_session, as_of=TODAY) == 0


def test_send_due_action_reminders_no_subscriptions_is_a_noop(db_session) -> None:
    _action(db_session, TODAY)
    assert send_due_action_reminders(db_session, as_of=TODAY) == 0


def test_send_due_action_reminders_without_vapid_keys_does_not_raise(db_session) -> None:
    """backend/.env.example ships with blank VAPID keys, same as this test
    environment - the job must degrade gracefully (return, don't crash the
    scheduler) rather than propagate PushNotConfiguredError."""
    _action(db_session, TODAY)
    db_session.add(
        PushSubscription(endpoint="https://push.example/test", p256dh_key="key", auth_key="auth")
    )
    db_session.commit()

    assert send_due_action_reminders(db_session, as_of=TODAY) == 0
