"""Reminder/agenda scheduled job (see app/services/reminders.py,
app/core/scheduler.py) - due_actions() filtering and
send_due_action_reminders()'s graceful no-crash behavior."""

from datetime import date, timedelta

import pytest

from app.core.config import settings
from app.models.action import Action, ActionStatus, ActionType
from app.models.push_subscription import PushSubscription
from app.services.reminders import (
    REMINDER_LOOKAHEAD_DAYS,
    _notification_payload,
    due_actions,
    send_due_action_reminders,
)

pytestmark = pytest.mark.integration

TODAY = date(2027, 6, 15)


def _action(db_session, due_date_end: date | None, status: ActionStatus = ActionStatus.pending) -> Action:
    action = Action(action_type=ActionType.sow, due_date_end=due_date_end, status=status)
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


def test_send_due_action_reminders_sends_one_push_per_action_per_subscription(db_session, monkeypatch) -> None:
    """With VAPID configured and every send succeeding, the returned count
    is actions * subscriptions - real coverage of the nested send loop
    itself, not just the "nothing configured yet" degrade path every other
    test in this file exercises."""
    monkeypatch.setattr(settings, "vapid_private_key", "fake-private-key")
    monkeypatch.setattr(settings, "vapid_public_key", "fake-public-key")

    _action(db_session, TODAY)
    _action(db_session, TODAY - timedelta(days=2))
    db_session.add(PushSubscription(endpoint="https://push.example/a", p256dh_key="p", auth_key="a"))
    db_session.add(PushSubscription(endpoint="https://push.example/b", p256dh_key="p", auth_key="a"))
    db_session.commit()

    import app.services.push as push_module

    monkeypatch.setattr(push_module, "webpush", lambda **kwargs: "ok")

    assert send_due_action_reminders(db_session, as_of=TODAY) == 4


def test_send_due_action_reminders_does_not_count_a_failed_send_and_keeps_going(db_session, monkeypatch) -> None:
    """A single subscription's push failing (an ordinary delivery failure,
    not a config problem - send_push_notification returns False rather than
    raising) shouldn't stop the rest of the loop or inflate the returned
    count - matches send_push_notification's own "a single bad subscription
    shouldn't crash the loop" contract (see app/services/push.py)."""
    monkeypatch.setattr(settings, "vapid_private_key", "fake-private-key")
    monkeypatch.setattr(settings, "vapid_public_key", "fake-public-key")

    _action(db_session, TODAY)
    db_session.add(PushSubscription(endpoint="https://push.example/fails", p256dh_key="p", auth_key="a"))
    db_session.add(PushSubscription(endpoint="https://push.example/works", p256dh_key="p", auth_key="a"))
    db_session.commit()

    import app.services.push as push_module
    from pywebpush import WebPushException

    calls = {"n": 0}

    def _flaky(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise WebPushException("delivery failed")
        return "ok"

    monkeypatch.setattr(push_module, "webpush", _flaky)

    assert send_due_action_reminders(db_session, as_of=TODAY) == 1
    assert calls["n"] == 2  # both subscriptions were still attempted


def test_send_due_action_reminders_bails_the_whole_loop_on_first_not_configured(db_session, monkeypatch) -> None:
    """A single subscription raising PushNotConfiguredError means VAPID
    itself isn't set up - a global config problem, not specific to that one
    subscription/action - so the loop deliberately bails entirely (returns
    whatever was already sent so far) rather than continuing to retry every
    other (action, subscription) pair that would also fail the exact same
    way. With 2 due actions x 2 subscriptions = 4 possible sends, a
    per-pair-continue bug would still call the send function all 4 times;
    the real "bail entirely" behavior calls it exactly once, which the
    return-value-only tests elsewhere in this file can't distinguish (both
    behaviors return 0 either way)."""
    import app.services.reminders as reminders_module
    from app.services.push import PushNotConfiguredError

    _action(db_session, TODAY)
    _action(db_session, TODAY - timedelta(days=1))
    db_session.add(PushSubscription(endpoint="https://push.example/x", p256dh_key="p", auth_key="a"))
    db_session.add(PushSubscription(endpoint="https://push.example/y", p256dh_key="p", auth_key="a"))
    db_session.commit()

    calls = {"n": 0}

    def _raise_not_configured(*args, **kwargs):
        calls["n"] += 1
        raise PushNotConfiguredError("VAPID not configured")

    monkeypatch.setattr(reminders_module, "send_push_notification", _raise_not_configured)

    assert send_due_action_reminders(db_session, as_of=TODAY) == 0
    assert calls["n"] == 1, "should bail after the very first PushNotConfiguredError, not retry every pair"


class TestNotificationPayload:
    def test_formats_action_type_label_and_due_date(self, db_session) -> None:
        action = _action(db_session, TODAY)
        payload = _notification_payload(action)
        assert '"title": "GardenBedPlanner reminder"' in payload
        assert "Sow due by 2027-06-15" in payload

    def test_underscored_action_type_becomes_a_capitalized_space_separated_label(self, db_session) -> None:
        action = Action(action_type=ActionType.prepare_bed, due_date_end=TODAY, status=ActionStatus.pending)
        db_session.add(action)
        db_session.commit()
        db_session.refresh(action)
        payload = _notification_payload(action)
        assert "Prepare bed due by 2027-06-15" in payload

    def test_falls_back_to_a_bare_label_when_due_date_end_is_absent(self, db_session) -> None:
        """due_actions() never actually yields an action with no
        due_date_end (it's filtered out), but _notification_payload has its
        own explicit fallback branch for that case - worth covering
        directly rather than leaving it untested dead code that could
        silently break."""
        action = _action(db_session, due_date_end=None)
        payload = _notification_payload(action)
        assert '"body": "Sow"' in payload
        assert "due by" not in payload
