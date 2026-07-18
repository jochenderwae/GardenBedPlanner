from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.bed import Bed

router = APIRouter(prefix="/beds", tags=["beds"])

# See plants.py's _PlantUpdate for why this is generated from Bed's own
# fields rather than retyped by hand.
_BedUpdate = create_model(
    "BedUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in Bed.model_fields.items()
        if name != "id"
    },
)


def _get_or_404(session: Session, bed_id: int) -> Bed:
    bed = session.get(Bed, bed_id)
    if bed is None:
        raise HTTPException(status_code=404, detail=f"No bed with id {bed_id}")
    return bed


@router.get("", response_model=list[Bed])
def list_beds(session: Session = Depends(get_session)) -> list[Bed]:
    return list(session.exec(select(Bed)).all())


@router.get("/{bed_id}", response_model=Bed)
def get_bed(bed_id: int, session: Session = Depends(get_session)) -> Bed:
    return _get_or_404(session, bed_id)


@router.post("", response_model=Bed, status_code=201)
def create_bed(bed: Bed, session: Session = Depends(get_session)) -> Bed:
    bed.id = None  # server-assigned - never trust a client-supplied id on create
    session.add(bed)
    commit_or_409(session)
    session.refresh(bed)
    return bed


@router.patch("/{bed_id}", response_model=Bed)
def update_bed(
    bed_id: int, update: _BedUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Bed:
    bed = _get_or_404(session, bed_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(bed, field, value)
    session.add(bed)
    commit_or_409(session)
    session.refresh(bed)
    return bed


@router.delete("/{bed_id}", status_code=204)
def delete_bed(bed_id: int, session: Session = Depends(get_session)) -> None:
    bed = _get_or_404(session, bed_id)
    session.delete(bed)
    commit_or_409(session)
