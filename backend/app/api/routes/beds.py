from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.core.db import get_session
from app.models.bed import Bed

router = APIRouter(prefix="/beds", tags=["beds"])


@router.get("", response_model=list[Bed])
def list_beds(session: Session = Depends(get_session)) -> list[Bed]:
    return list(session.exec(select(Bed)).all())


@router.post("", response_model=Bed)
def create_bed(bed: Bed, session: Session = Depends(get_session)) -> Bed:
    session.add(bed)
    session.commit()
    session.refresh(bed)
    return bed
