from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.action import Action as ActionTable
from app.models.action import ActionStatus, ActionType
from app.services.recurrence import generate_next_occurrence
from app.services.reminders import next_saturday

router = APIRouter(prefix="/actions", tags=["actions"])

_ACTION_FIELDS = {name: field for name, field in ActionTable.model_fields.items()}


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_ActionCreate = create_model(
    "ActionCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _ACTION_FIELDS.items() if name != "id"},
)

_ActionUpdate = create_model(
    "ActionUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _ACTION_FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, action_id: int) -> ActionTable:
    action = session.get(ActionTable, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail=f"No action with id {action_id}")
    return action


@router.get("", response_model=list[ActionTable])
def list_actions(
    due_from: date | None = Query(
        default=None, description="Only actions whose window starts on/after this date"
    ),
    due_to: date | None = Query(
        default=None, description="Only actions whose window ends on/before this date"
    ),
    status: ActionStatus | None = Query(default=None),
    action_type: ActionType | None = Query(default=None),
    actionable_now: bool = Query(
        default=False,
        description=(
            "Only pending actions whose window has already opened "
            "(due_date_start <= today) - 'what can I pick up right now' "
            "(#192) - sorted by due_date_end ascending (closest "
            "finish-before date first)."
        ),
    ),
    session: Session = Depends(get_session),
) -> list[ActionTable]:
    query = select(ActionTable)
    if due_from is not None:
        query = query.where(ActionTable.due_date_start >= due_from)
    if due_to is not None:
        query = query.where(ActionTable.due_date_end <= due_to)
    if status is not None:
        query = query.where(ActionTable.status == status)
    if action_type is not None:
        query = query.where(ActionTable.action_type == action_type)
    if actionable_now:
        today = date.today()
        query = query.where(ActionTable.status == ActionStatus.pending)
        query = query.where(ActionTable.due_date_start.is_not(None))
        query = query.where(ActionTable.due_date_start <= today)
        query = query.order_by(ActionTable.due_date_end)
    return list(session.exec(query).all())


@router.get("/{action_id}", response_model=ActionTable)
def get_action(action_id: int, session: Session = Depends(get_session)) -> ActionTable:
    return _get_or_404(session, action_id)


@router.post("", response_model=ActionTable, status_code=201)
def create_action(
    action: _ActionCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> ActionTable:
    row = ActionTable(**action.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{action_id}", response_model=ActionTable)
def update_action(
    action_id: int, update: _ActionUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> ActionTable:
    action = _get_or_404(session, action_id)
    previous_status = action.status
    changes = update.model_dump(exclude_unset=True)
    # Setting a completed_date without an explicit status is "marking it
    # done" - default status to completed rather than leaving it pending,
    # same spirit as Bed's "raised" being derived rather than a separate
    # field the caller has to remember to keep in sync (see app/models/bed.py).
    # An explicit status in the same request always wins.
    if "completed_date" in changes and changes["completed_date"] is not None and "status" not in changes:
        changes["status"] = ActionStatus.completed
    for field, value in changes.items():
        setattr(action, field, value)
    session.add(action)
    # #226: generate the next occurrence of a recurring Action the moment
    # it transitions into a terminal status (completed *or* skipped - a
    # skipped chore isn't a cancelled recurrence, only recurrence_end_date
    # stops generation). Gated on the *transition* (previous_status wasn't
    # already terminal), not just "is currently completed/skipped", so a
    # redundant PATCH re-saving an already-completed action doesn't
    # generate a duplicate occurrence every time it's called.
    newly_terminal = (
        previous_status not in (ActionStatus.completed, ActionStatus.skipped)
        and action.status in (ActionStatus.completed, ActionStatus.skipped)
    )
    if newly_terminal:
        generate_next_occurrence(session, action)
    commit_or_409(session)
    session.refresh(action)
    return action


@router.delete("/{action_id}", status_code=204)
def delete_action(action_id: int, session: Session = Depends(get_session)) -> None:
    action = _get_or_404(session, action_id)
    session.delete(action)
    commit_or_409(session)


@router.post("/{action_id}/snooze", response_model=ActionTable)
def snooze_action(
    action_id: int,
    until: date | None = Query(
        default=None, description="Defaults to the upcoming Saturday (Dave's own 'this weekend' framing) if omitted"
    ),
    session: Session = Depends(get_session),
) -> ActionTable:
    """#230: "remind me later" - suppresses further reminder pushes
    (app/services/reminders.py's due_actions) without touching this
    action's actual due_date_start/due_date_end window at all. A dedicated
    endpoint rather than requiring the caller (the service worker's own
    notificationclick handler, or #231's in-app snooze affordance) to shape
    a full PATCH body - PATCH /api/actions/{id} still accepts snoozed_until
    like any other field too, this is just the lighter-weight path."""
    action = _get_or_404(session, action_id)
    action.snoozed_until = until if until is not None else next_saturday(date.today())
    session.add(action)
    commit_or_409(session)
    session.refresh(action)
    return action
