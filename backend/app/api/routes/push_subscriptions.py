import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.config import settings
from app.core.db import get_session
from app.models.push_subscription import PushSubscription as PushSubscriptionTable
from app.services.push import PushNotConfiguredError, send_push_notification

router = APIRouter(prefix="/push-subscriptions", tags=["push-subscriptions"])


class PushSubscriptionRegister(BaseModel):
    """Mirrors the browser's PushSubscription.toJSON() shape (endpoint +
    keys.p256dh/keys.auth) - the frontend passes this straight through from
    PushManager.subscribe(), plus an optional user_agent for debugging."""

    endpoint: str
    keys: dict[str, str]
    user_agent: str | None = None


class TestSendRequest(BaseModel):
    title: str = "GardenBedPlanner"
    body: str = "Test notification"


def _get_or_404(session: Session, subscription_id: int) -> PushSubscriptionTable:
    item = session.get(PushSubscriptionTable, subscription_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No push subscription with id {subscription_id}")
    return item


@router.get("/vapid-public-key")
def get_vapid_public_key() -> dict:
    """The frontend needs this to call PushManager.subscribe({applicationServerKey: ...})
    (see #47) - exposed as a plain public value, not a secret."""
    return {"public_key": settings.vapid_public_key}


@router.get("", response_model=list[PushSubscriptionTable])
def list_push_subscriptions(session: Session = Depends(get_session)) -> list[PushSubscriptionTable]:
    return list(session.exec(select(PushSubscriptionTable)).all())


@router.post("", response_model=PushSubscriptionTable, status_code=201)
def register_push_subscription(
    payload: PushSubscriptionRegister, session: Session = Depends(get_session)
) -> PushSubscriptionTable:
    p256dh = payload.keys.get("p256dh")
    auth = payload.keys.get("auth")
    if not p256dh or not auth:
        raise HTTPException(status_code=422, detail="keys.p256dh and keys.auth are required")

    # Upsert by endpoint - re-registering the same device/browser (e.g.
    # after the push service rotates the endpoint, or just re-running
    # subscribe()) updates the existing row rather than creating a
    # duplicate one no one will ever clean up.
    existing = session.exec(
        select(PushSubscriptionTable).where(PushSubscriptionTable.endpoint == payload.endpoint)
    ).first()
    if existing:
        existing.p256dh_key = p256dh
        existing.auth_key = auth
        existing.user_agent = payload.user_agent
        session.add(existing)
        commit_or_409(session)
        session.refresh(existing)
        return existing

    row = PushSubscriptionTable(
        endpoint=payload.endpoint, p256dh_key=p256dh, auth_key=auth, user_agent=payload.user_agent
    )
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.delete("/{subscription_id}", status_code=204)
def delete_push_subscription(subscription_id: int, session: Session = Depends(get_session)) -> None:
    item = _get_or_404(session, subscription_id)
    session.delete(item)
    commit_or_409(session)


@router.post("/{subscription_id}/send-test")
def send_test_push(
    subscription_id: int, payload: TestSendRequest, session: Session = Depends(get_session)
) -> dict:
    """Manual verification hook for the "How to test" flow - triggers a
    real send against one registered subscription so the deployed backend
    can be checked against an actual device/browser."""
    subscription = _get_or_404(session, subscription_id)
    try:
        sent = send_push_notification(
            session, subscription, json.dumps({"title": payload.title, "body": payload.body})
        )
    except PushNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"sent": sent}
