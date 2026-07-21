"""PushSubscription registration/list/delete (app/api/routes/push_subscriptions.py)
and the send_push_notification service (app/services/push.py), which the
real pywebpush call is monkeypatched out of - no real push service to talk
to in a test environment."""

import pytest
from fastapi.testclient import TestClient
from pywebpush import WebPushException

from app.core.config import settings
from app.models.push_subscription import PushSubscription
from app.services.push import PushNotConfiguredError, send_push_notification

pytestmark = pytest.mark.integration


def _register(client: TestClient, endpoint: str = "https://push.example.com/abc") -> dict:
    response = client.post(
        "/api/push-subscriptions",
        json={"endpoint": endpoint, "keys": {"p256dh": "p256dh-value", "auth": "auth-value"}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_register_push_subscription(client: TestClient) -> None:
    subscription = _register(client)
    assert subscription["endpoint"] == "https://push.example.com/abc"
    assert subscription["p256dh_key"] == "p256dh-value"


def test_register_missing_keys_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/push-subscriptions", json={"endpoint": "https://push.example.com/abc", "keys": {}}
    )
    assert response.status_code == 422


def test_re_registering_same_endpoint_updates_in_place(client: TestClient) -> None:
    first = _register(client)
    response = client.post(
        "/api/push-subscriptions",
        json={
            "endpoint": "https://push.example.com/abc",
            "keys": {"p256dh": "new-p256dh", "auth": "new-auth"},
        },
    )
    assert response.status_code == 201, response.text
    second = response.json()
    assert second["id"] == first["id"]
    assert second["p256dh_key"] == "new-p256dh"

    list_response = client.get("/api/push-subscriptions")
    assert len(list_response.json()) == 1


def test_delete_push_subscription(client: TestClient) -> None:
    subscription_id = _register(client)["id"]
    delete_response = client.delete(f"/api/push-subscriptions/{subscription_id}")
    assert delete_response.status_code == 204
    assert client.get("/api/push-subscriptions").json() == []


def test_delete_missing_push_subscription_404(client: TestClient) -> None:
    assert client.delete("/api/push-subscriptions/999999").status_code == 404


def test_vapid_public_key_endpoint_returns_configured_value(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_public_key", "test-public-key")
    response = client.get("/api/push-subscriptions/vapid-public-key")
    assert response.status_code == 200
    assert response.json()["public_key"] == "test-public-key"


def test_send_test_push_503_when_vapid_not_configured(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_private_key", "")
    monkeypatch.setattr(settings, "vapid_public_key", "")
    subscription_id = _register(client)["id"]
    response = client.post(f"/api/push-subscriptions/{subscription_id}/send-test", json={})
    assert response.status_code == 503


def test_send_push_notification_success(db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_private_key", "fake-private-key")
    monkeypatch.setattr(settings, "vapid_public_key", "fake-public-key")
    subscription = PushSubscription(
        endpoint="https://push.example.com/success", p256dh_key="p", auth_key="a"
    )
    db_session.add(subscription)
    db_session.commit()

    import app.services.push as push_module

    monkeypatch.setattr(push_module, "webpush", lambda **kwargs: "ok")
    assert send_push_notification(db_session, subscription, '{"title": "hi"}') is True
    # Successful send doesn't touch the subscription row.
    assert db_session.get(PushSubscription, subscription.id) is not None


def test_send_push_notification_deletes_subscription_on_410_gone(db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_private_key", "fake-private-key")
    monkeypatch.setattr(settings, "vapid_public_key", "fake-public-key")
    subscription = PushSubscription(
        endpoint="https://push.example.com/gone", p256dh_key="p", auth_key="a"
    )
    db_session.add(subscription)
    db_session.commit()
    subscription_id = subscription.id

    class _FakeResponse:
        status_code = 410

    def _raise(**kwargs):
        raise WebPushException("gone", response=_FakeResponse())

    import app.services.push as push_module

    monkeypatch.setattr(push_module, "webpush", _raise)
    result = send_push_notification(db_session, subscription, '{"title": "hi"}')
    assert result is False
    assert db_session.get(PushSubscription, subscription_id) is None


def test_send_push_notification_keeps_subscription_on_other_failure(db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_private_key", "fake-private-key")
    monkeypatch.setattr(settings, "vapid_public_key", "fake-public-key")
    subscription = PushSubscription(
        endpoint="https://push.example.com/error", p256dh_key="p", auth_key="a"
    )
    db_session.add(subscription)
    db_session.commit()
    subscription_id = subscription.id

    class _FakeResponse:
        status_code = 500

    def _raise(**kwargs):
        raise WebPushException("server error", response=_FakeResponse())

    import app.services.push as push_module

    monkeypatch.setattr(push_module, "webpush", _raise)
    result = send_push_notification(db_session, subscription, '{"title": "hi"}')
    assert result is False
    assert db_session.get(PushSubscription, subscription_id) is not None


def test_send_push_notification_raises_when_not_configured(db_session, monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_private_key", "")
    monkeypatch.setattr(settings, "vapid_public_key", "")
    subscription = PushSubscription(
        endpoint="https://push.example.com/unconfigured", p256dh_key="p", auth_key="a"
    )
    db_session.add(subscription)
    db_session.commit()

    with pytest.raises(PushNotConfiguredError):
        send_push_notification(db_session, subscription, '{"title": "hi"}')
