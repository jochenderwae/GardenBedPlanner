from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.plant import PeriodType

router = APIRouter(prefix="/period-types", tags=["period-types"])


class PeriodTypeUpdate(BaseModel):
    description: str | None = None


def _get_or_404(session: Session, code: str) -> PeriodType:
    item = session.get(PeriodType, code)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No period_type with code {code!r}")
    return item


@router.get("", response_model=list[PeriodType])
def list_period_types(session: Session = Depends(get_session)) -> list[PeriodType]:
    return list(session.exec(select(PeriodType)).all())


@router.get("/{code}", response_model=PeriodType)
def get_period_type(code: str, session: Session = Depends(get_session)) -> PeriodType:
    return _get_or_404(session, code)


@router.post("", response_model=PeriodType, status_code=201)
def create_period_type(item: PeriodType, session: Session = Depends(get_session)) -> PeriodType:
    if session.get(PeriodType, item.code) is not None:
        raise HTTPException(status_code=409, detail=f"period_type {item.code!r} already exists")
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.patch("/{code}", response_model=PeriodType)
def update_period_type(
    code: str, update: PeriodTypeUpdate, session: Session = Depends(get_session)
) -> PeriodType:
    item = _get_or_404(session, code)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.delete("/{code}", status_code=204)
def delete_period_type(code: str, session: Session = Depends(get_session)) -> None:
    item = _get_or_404(session, code)
    session.delete(item)
    # A period_type still referenced by plant_period rows correctly 409s
    # here (no cascade) - deleting a code out from under existing data
    # should be a conflict the client has to resolve, not a silent cascade.
    commit_or_409(session)
