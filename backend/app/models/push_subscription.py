from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    # Naive UTC datetime (matches the migration's plain DateTime() column,
    # no timezone) - datetime.utcnow() is deprecated in favor of
    # datetime.now(UTC), but that's timezone-aware; strip the tzinfo back
    # off rather than switch the column to timestamptz for this.
    return datetime.now(UTC).replace(tzinfo=None)


class PushSubscription(SQLModel, table=True):
    """A browser's Web Push subscription (endpoint + the two encryption
    keys from the client's PushSubscription.toJSON(), see
    https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) -
    registered once the PWA's service worker requests notification
    permission (#47). No auth/multi-device management needed in v1 (single
    user, per root CLAUDE.md) - endpoint is unique so re-registering the
    same device/browser updates its keys in place rather than creating a
    duplicate row."""

    __tablename__ = "push_subscription"

    id: int | None = Field(default=None, primary_key=True)
    endpoint: str = Field(unique=True, index=True)
    p256dh_key: str
    auth_key: str
    user_agent: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)
