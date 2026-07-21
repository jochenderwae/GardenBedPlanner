"""Web Push send helper (VAPID via pywebpush) - the backend half of native
Web Push notifications, per root CLAUDE.md's tech-stack note (no
third-party push service like ntfy; browsers deliver directly against
each subscription's own push service using our VAPID keys). Shared by the
manual test-send route (app/api/routes/push_subscriptions.py) and, later,
the reminder/agenda scheduled job (#48) and any other future trigger.
"""

import logging

from pywebpush import WebPushException, webpush
from sqlmodel import Session

from app.core.config import settings
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)


class PushNotConfiguredError(RuntimeError):
    """Raised when VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY aren't set yet -
    distinct from an ordinary send failure, so a caller (and the API route
    wrapping this) can tell "there's nothing to send with" apart from "the
    send itself failed against a real subscription"."""


def send_push_notification(session: Session, subscription: PushSubscription, payload: str) -> bool:
    """Sends `payload` (a pre-serialized JSON string - the caller decides
    the notification's shape, e.g. {"title": ..., "body": ...}) to one
    subscription. Returns True/False rather than raising on an ordinary
    delivery failure - a single bad subscription shouldn't crash whatever
    loop/job is sending to several of them (see #48's future use of this).

    A 404/410 response means the push service itself says this
    subscription is gone (browser uninstalled, permission revoked,
    endpoint expired) - deletes the row so it stops being retried forever
    rather than accumulating dead subscriptions."""
    if not settings.vapid_private_key or not settings.vapid_public_key:
        raise PushNotConfiguredError(
            "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured - see backend/.env.example"
        )
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh_key, "auth": subscription.auth_key},
            },
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": f"mailto:{settings.vapid_admin_email}"},
        )
        return True
    except WebPushException as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code in (404, 410):
            session.delete(subscription)
            session.commit()
        else:
            logger.warning("Push send failed (status=%s): %s", status_code, exc)
        return False
