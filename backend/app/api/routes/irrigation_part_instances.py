from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, or_, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.irrigation_connection import IrrigationConnection as IrrigationConnectionTable
from app.models.irrigation_part_instance import IrrigationPartInstance as IrrigationPartInstanceTable

# #254: one placed physical unit of an IrrigationPart stock row - see that
# model's own docstring for why this is split out from irrigation_parts.py
# rather than folded into it. Same create_model-from-table-fields pattern
# every other route module here already uses.
router = APIRouter(prefix="/irrigation-part-instances", tags=["irrigation-part-instances"])

_INSTANCE_FIELDS = {name: field for name, field in IrrigationPartInstanceTable.model_fields.items()}


def _instance_field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_IrrigationPartInstanceCreate = create_model(
    "IrrigationPartInstanceCreate",
    __base__=BaseModel,
    **{name: _instance_field_tuple(field) for name, field in _INSTANCE_FIELDS.items() if name != "id"},
)

_IrrigationPartInstanceUpdate = create_model(
    "IrrigationPartInstanceUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _INSTANCE_FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, instance_id: int) -> IrrigationPartInstanceTable:
    instance = session.get(IrrigationPartInstanceTable, instance_id)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"No irrigation part instance with id {instance_id}")
    return instance


@router.get("", response_model=list[IrrigationPartInstanceTable])
def list_irrigation_part_instances(
    part_id: int | None = Query(default=None, description="Only instances of this part"),
    session: Session = Depends(get_session),
) -> list[IrrigationPartInstanceTable]:
    query = select(IrrigationPartInstanceTable)
    if part_id is not None:
        query = query.where(IrrigationPartInstanceTable.part_id == part_id)
    return list(session.exec(query).all())


@router.get("/{instance_id}", response_model=IrrigationPartInstanceTable)
def get_irrigation_part_instance(
    instance_id: int, session: Session = Depends(get_session)
) -> IrrigationPartInstanceTable:
    return _get_or_404(session, instance_id)


@router.post("", response_model=IrrigationPartInstanceTable, status_code=201)
def create_irrigation_part_instance(
    instance: _IrrigationPartInstanceCreate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationPartInstanceTable:
    row = IrrigationPartInstanceTable(**instance.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{instance_id}", response_model=IrrigationPartInstanceTable)
def update_irrigation_part_instance(
    instance_id: int,
    update: _IrrigationPartInstanceUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationPartInstanceTable:
    instance = _get_or_404(session, instance_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(instance, field, value)
    session.add(instance)
    commit_or_409(session)
    session.refresh(instance)
    return instance


@router.delete("/{instance_id}", status_code=204)
def delete_irrigation_part_instance(instance_id: int, session: Session = Depends(get_session)) -> None:
    instance = _get_or_404(session, instance_id)
    # Only this instance's own connections are removed - a sibling instance
    # of the same part type (a different physical unit) keeps its own
    # connections untouched, per #254's own test criterion 4.
    connections = list(
        session.exec(
            select(IrrigationConnectionTable).where(
                or_(
                    IrrigationConnectionTable.from_instance_id == instance_id,
                    IrrigationConnectionTable.to_instance_id == instance_id,
                )
            )
        ).all()
    )
    for connection in connections:
        session.delete(connection)
    session.delete(instance)
    commit_or_409(session)
