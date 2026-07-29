from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, or_, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.irrigation_connection import IrrigationConnection as IrrigationConnectionTable

router = APIRouter(prefix="/irrigation-connections", tags=["irrigation-connections"])

_CONNECTION_FIELDS = {name: field for name, field in IrrigationConnectionTable.model_fields.items()}


def _connection_field_tuple(field: Any) -> tuple[Any, Any]:
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


_IrrigationConnectionCreate = create_model(
    "IrrigationConnectionCreate",
    __base__=BaseModel,
    **{name: _connection_field_tuple(field) for name, field in _CONNECTION_FIELDS.items() if name != "id"},
)

_IrrigationConnectionUpdate = create_model(
    "IrrigationConnectionUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _CONNECTION_FIELDS.items() if name != "id"},
)


def _get_or_404(session: Session, connection_id: int) -> IrrigationConnectionTable:
    connection = session.get(IrrigationConnectionTable, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail=f"No irrigation connection with id {connection_id}")
    return connection


def _check_not_self_connection(from_part_id: int, to_part_id: int) -> None:
    if from_part_id == to_part_id:
        raise HTTPException(status_code=400, detail="A part cannot connect to itself")


@router.get("", response_model=list[IrrigationConnectionTable])
def list_irrigation_connections(
    part_id: int | None = Query(default=None, description="Only connections touching this part"),
    session: Session = Depends(get_session),
) -> list[IrrigationConnectionTable]:
    query = select(IrrigationConnectionTable)
    if part_id is not None:
        query = query.where(
            or_(
                IrrigationConnectionTable.from_part_id == part_id,
                IrrigationConnectionTable.to_part_id == part_id,
            )
        )
    return list(session.exec(query).all())


@router.get("/{connection_id}", response_model=IrrigationConnectionTable)
def get_irrigation_connection(
    connection_id: int, session: Session = Depends(get_session)
) -> IrrigationConnectionTable:
    return _get_or_404(session, connection_id)


@router.post("", response_model=IrrigationConnectionTable, status_code=201)
def create_irrigation_connection(
    connection: _IrrigationConnectionCreate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationConnectionTable:
    _check_not_self_connection(connection.from_part_id, connection.to_part_id)
    row = IrrigationConnectionTable(**connection.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{connection_id}", response_model=IrrigationConnectionTable)
def update_irrigation_connection(
    connection_id: int,
    update: _IrrigationConnectionUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> IrrigationConnectionTable:
    connection = _get_or_404(session, connection_id)
    data = update.model_dump(exclude_unset=True)
    new_from = data.get("from_part_id", connection.from_part_id)
    new_to = data.get("to_part_id", connection.to_part_id)
    _check_not_self_connection(new_from, new_to)
    for field, value in data.items():
        setattr(connection, field, value)
    session.add(connection)
    commit_or_409(session)
    session.refresh(connection)
    return connection


@router.delete("/{connection_id}", status_code=204)
def delete_irrigation_connection(connection_id: int, session: Session = Depends(get_session)) -> None:
    connection = _get_or_404(session, connection_id)
    session.delete(connection)
    commit_or_409(session)
