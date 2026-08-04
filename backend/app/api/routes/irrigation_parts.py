from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, or_, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.irrigation_connection import IrrigationConnection as IrrigationConnectionTable
from app.models.irrigation_part import IrrigationPart as IrrigationPartTable
from app.models.irrigation_part_instance import IrrigationPartInstance as IrrigationPartInstanceTable

router = APIRouter(prefix="/irrigation-parts", tags=["irrigation-parts"])

_PART_FIELDS = {name: field for name, field in IrrigationPartTable.model_fields.items()}


def _part_field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_IrrigationPartCreate = create_model(
    "IrrigationPartCreate",
    __base__=BaseModel,
    **{name: _part_field_tuple(field) for name, field in _PART_FIELDS.items() if name != "id"},
)

_IrrigationPartUpdate = create_model(
    "IrrigationPartUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _PART_FIELDS.items() if name != "id"},
)


class IrrigationPartDetail(BaseModel):
    """GET /irrigation-parts/{part_id} response: the part plus its derived
    "needs purchase" status - #37's test criterion 4, redefined by #254 in
    terms of placed instances rather than connections. instance_count is how
    many IrrigationPartInstance rows exist for this part (each one a
    physical unit placed on the diagram); this is never stored, only
    computed here, same "no dedicated flag" reasoning as #41's seed-buying
    agenda. needs_purchase flags (never blocks) placing more instances than
    quantity_on_hand actually covers - #254's own test criterion 3."""

    id: int
    name: str
    part_type: str
    quantity_on_hand: int
    notes: str
    connector_size_mm: float | None
    instance_count: int
    needs_purchase: bool


def _get_or_404(session: Session, part_id: int) -> IrrigationPartTable:
    part = session.get(IrrigationPartTable, part_id)
    if part is None:
        raise HTTPException(status_code=404, detail=f"No irrigation part with id {part_id}")
    return part


def _instance_count(session: Session, part_id: int) -> int:
    rows = session.exec(
        select(IrrigationPartInstanceTable).where(IrrigationPartInstanceTable.part_id == part_id)
    ).all()
    return len(rows)


def _to_detail(session: Session, part: IrrigationPartTable) -> IrrigationPartDetail:
    count = _instance_count(session, part.id)
    return IrrigationPartDetail(
        id=part.id,
        name=part.name,
        part_type=part.part_type,
        quantity_on_hand=part.quantity_on_hand,
        notes=part.notes,
        connector_size_mm=part.connector_size_mm,
        instance_count=count,
        needs_purchase=count > part.quantity_on_hand,
    )


@router.get("", response_model=list[IrrigationPartTable])
def list_irrigation_parts(session: Session = Depends(get_session)) -> list[IrrigationPartTable]:
    return list(session.exec(select(IrrigationPartTable)).all())


@router.get("/{part_id}", response_model=IrrigationPartDetail)
def get_irrigation_part(part_id: int, session: Session = Depends(get_session)) -> IrrigationPartDetail:
    part = _get_or_404(session, part_id)
    return _to_detail(session, part)


@router.post("", response_model=IrrigationPartTable, status_code=201)
def create_irrigation_part(
    part: _IrrigationPartCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> IrrigationPartTable:
    row = IrrigationPartTable(**part.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{part_id}", response_model=IrrigationPartTable)
def update_irrigation_part(
    part_id: int, update: _IrrigationPartUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> IrrigationPartTable:
    part = _get_or_404(session, part_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(part, field, value)
    session.add(part)
    commit_or_409(session)
    session.refresh(part)
    return part


@router.delete("/{part_id}", status_code=204)
def delete_irrigation_part(part_id: int, session: Session = Depends(get_session)) -> None:
    part = _get_or_404(session, part_id)
    # #254: connections now hang off this part's IrrigationPartInstance rows,
    # not off the part directly - clean up every instance's connections,
    # then the instances themselves, before the part row, rather than
    # surfacing a raw 409 for what's a legitimate "remove this part, its
    # placed instances, and their connections" action.
    instances = list(
        session.exec(select(IrrigationPartInstanceTable).where(IrrigationPartInstanceTable.part_id == part_id)).all()
    )
    instance_ids = [instance.id for instance in instances]
    if instance_ids:
        connections = list(
            session.exec(
                select(IrrigationConnectionTable).where(
                    or_(
                        IrrigationConnectionTable.from_instance_id.in_(instance_ids),
                        IrrigationConnectionTable.to_instance_id.in_(instance_ids),
                    )
                )
            ).all()
        )
        for connection in connections:
            session.delete(connection)
    # Explicit flushes between each level - with no ORM relationship()
    # declared between these tables (deliberately, per every model here's
    # own "flat FK, not a graph model" docstring), SQLAlchemy's unit-of-work
    # doesn't know connection -> instance -> part is a dependency chain and
    # won't otherwise guarantee DELETE statements go out in that order,
    # which would FK-violate deleting a still-referenced instance/part.
    session.flush()
    for instance in instances:
        session.delete(instance)
    session.flush()
    session.delete(part)
    commit_or_409(session)
