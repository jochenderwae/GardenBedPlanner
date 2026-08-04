from pydantic import BaseModel, create_model
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import commit_or_409, get_active_garden
from app.core.db import get_session
from app.models.garden_plan import GardenPlan as GardenPlanTable
from app.models.garden_plan import GardenPlanEntry as GardenPlanEntryTable

# GardenPlan and GardenPlanEntry share this one module (same rationale
# plants.py bundles Plant + its satellite tables) - an entry is meaningless
# without its parent plan, so they're one resource family, not two.
router = APIRouter(prefix="/garden-plans", tags=["garden-plans"])


def _field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


# Neither table has a jsonb column (no Geometry split needed, unlike
# beds.py/plantings.py/bed_equipment.py) - Create/Update schemas are still
# generated from the table's own fields rather than retyped by hand, same
# reasoning as every other route module here, so a future field addition
# doesn't have to be remembered in four places.
_PLAN_FIELDS = {name: field for name, field in GardenPlanTable.model_fields.items()}

_GardenPlanCreate = create_model(
    "GardenPlanCreate",
    __base__=BaseModel,
    **{name: _field_tuple(field) for name, field in _PLAN_FIELDS.items() if name != "id"},
)

_GardenPlanUpdate = create_model(
    "GardenPlanUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _PLAN_FIELDS.items() if name != "id"},
)

_ENTRY_FIELDS = {name: field for name, field in GardenPlanEntryTable.model_fields.items()}

# garden_plan_id comes from the URL (POST /garden-plans/{plan_id}/entries),
# not the request body - excluded here same as id, not just from Update.
_GardenPlanEntryCreate = create_model(
    "GardenPlanEntryCreate",
    __base__=BaseModel,
    **{
        name: _field_tuple(field)
        for name, field in _ENTRY_FIELDS.items()
        if name not in ("id", "garden_plan_id")
    },
)

_GardenPlanEntryUpdate = create_model(
    "GardenPlanEntryUpdate",
    __base__=BaseModel,
    **{name: (field.annotation | None, None) for name, field in _ENTRY_FIELDS.items() if name != "id"},
)


class GardenPlanDetail(BaseModel):
    """GET /garden-plans/{id} response: the plan plus its entries, mirroring
    the PlantDetail (plants.py) pattern of a flat list response vs. a
    detail response that assembles satellite rows."""

    id: int
    garden_id: int | None = None
    season_name: str
    year: int
    notes: str = ""
    entries: list[GardenPlanEntryTable] = []


def _get_plan_or_404(session: Session, plan_id: int) -> GardenPlanTable:
    plan = session.get(GardenPlanTable, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"No garden plan with id {plan_id}")
    return plan


def _get_entry_or_404(session: Session, plan_id: int, entry_id: int) -> GardenPlanEntryTable:
    entry = session.get(GardenPlanEntryTable, entry_id)
    if entry is None or entry.garden_plan_id != plan_id:
        raise HTTPException(
            status_code=404, detail=f"No entry {entry_id} on garden plan {plan_id}"
        )
    return entry


@router.get("", response_model=list[GardenPlanTable])
def list_garden_plans(session: Session = Depends(get_session)) -> list[GardenPlanTable]:
    return list(session.exec(select(GardenPlanTable)).all())


@router.get("/{plan_id}", response_model=GardenPlanDetail)
def get_garden_plan(plan_id: int, session: Session = Depends(get_session)) -> GardenPlanDetail:
    plan = _get_plan_or_404(session, plan_id)
    entries = list(
        session.exec(
            select(GardenPlanEntryTable).where(GardenPlanEntryTable.garden_plan_id == plan_id)
        ).all()
    )
    return GardenPlanDetail(**plan.model_dump(), entries=entries)


@router.post("", response_model=GardenPlanTable, status_code=201)
def create_garden_plan(
    plan: _GardenPlanCreate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> GardenPlanTable:
    data = plan.model_dump()
    # #238: same server-side active-garden resolution as beds.py's
    # create_bed - only when the client didn't supply garden_id explicitly,
    # and only when a garden actually exists yet.
    if "garden_id" not in plan.model_fields_set:
        active_garden = get_active_garden(session)
        if active_garden is not None:
            data["garden_id"] = active_garden.id
    row = GardenPlanTable(**data)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{plan_id}", response_model=GardenPlanTable)
def update_garden_plan(
    plan_id: int, update: _GardenPlanUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> GardenPlanTable:
    plan = _get_plan_or_404(session, plan_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    session.add(plan)
    commit_or_409(session)
    session.refresh(plan)
    return plan


@router.delete("/{plan_id}", status_code=204)
def delete_garden_plan(
    plan_id: int, cascade: bool = False, session: Session = Depends(get_session)
) -> None:
    plan = _get_plan_or_404(session, plan_id)
    if cascade:
        for entry in session.exec(
            select(GardenPlanEntryTable).where(GardenPlanEntryTable.garden_plan_id == plan_id)
        ).all():
            session.delete(entry)
        session.flush()
    session.delete(plan)
    commit_or_409(session)


@router.get("/{plan_id}/entries", response_model=list[GardenPlanEntryTable])
def list_garden_plan_entries(
    plan_id: int, session: Session = Depends(get_session)
) -> list[GardenPlanEntryTable]:
    _get_plan_or_404(session, plan_id)
    return list(
        session.exec(
            select(GardenPlanEntryTable).where(GardenPlanEntryTable.garden_plan_id == plan_id)
        ).all()
    )


@router.post("/{plan_id}/entries", response_model=GardenPlanEntryTable, status_code=201)
def create_garden_plan_entry(
    plan_id: int,
    entry: _GardenPlanEntryCreate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> GardenPlanEntryTable:
    _get_plan_or_404(session, plan_id)
    data = entry.model_dump()
    data["garden_plan_id"] = plan_id
    row = GardenPlanEntryTable(**data)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    return row


@router.patch("/{plan_id}/entries/{entry_id}", response_model=GardenPlanEntryTable)
def update_garden_plan_entry(
    plan_id: int,
    entry_id: int,
    update: _GardenPlanEntryUpdate,  # type: ignore[valid-type]
    session: Session = Depends(get_session),
) -> GardenPlanEntryTable:
    entry = _get_entry_or_404(session, plan_id, entry_id)
    changes = update.model_dump(exclude_unset=True)
    # garden_plan_id isn't reassignable through this nested route - moving
    # an entry to a different plan isn't a thing this feature needs yet,
    # and silently allowing it here would let the plan_id in the URL and
    # the row's real parent drift apart.
    changes.pop("garden_plan_id", None)
    for field, value in changes.items():
        setattr(entry, field, value)
    session.add(entry)
    commit_or_409(session)
    session.refresh(entry)
    return entry


@router.delete("/{plan_id}/entries/{entry_id}", status_code=204)
def delete_garden_plan_entry(
    plan_id: int, entry_id: int, session: Session = Depends(get_session)
) -> None:
    entry = _get_entry_or_404(session, plan_id, entry_id)
    session.delete(entry)
    commit_or_409(session)
