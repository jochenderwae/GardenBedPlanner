from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.action import Action
from app.models.bed import Bed as BedTable
from app.models.bed_equipment import BedEquipment
from app.models.compost_bin import CompostBin
from app.models.compost_fertilization_log import CompostFertilizationLog
from app.models.geometry import Geometry, parse_geometry
from app.models.planting import Planting
from app.services.task_generation import generate_bed_tasks

router = APIRouter(prefix="/beds", tags=["beds"])

# Every BedTable field except border_geometry, which is stored as a raw
# dict at the table level (Postgres jsonb) and only gets its real
# discriminated-union type (Geometry) here at the API boundary - same
# split app/api/routes/plants.py uses for family/genus (FK ints in the
# table, nested read objects in the API).
_BED_TABLE_FIELDS = {name: field for name, field in BedTable.model_fields.items() if name != "border_geometry"}


def _bed_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


# API read/write shape for a bed. Deliberately not `class Bed(BedTable)` -
# SQLModel's metaclass turns every added field into a table column even on
# a subclass without its own table=True (same reasoning plants.py's own
# `Plant` read schema documents).
Bed = create_model(
    "Bed",
    __base__=BaseModel,
    **{name: _bed_field_tuple(field) for name, field in _BED_TABLE_FIELDS.items()},
    border_geometry=(Geometry, ...),
)

_BedCreate = create_model(
    "BedCreate",
    __base__=BaseModel,
    **{name: _bed_field_tuple(field) for name, field in _BED_TABLE_FIELDS.items() if name != "id"},
    border_geometry=(Geometry, ...),
)

# See plants.py's _PlantUpdate for why this is generated from the table's
# own fields rather than retyped by hand.
_BedUpdate = create_model(
    "BedUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _BED_TABLE_FIELDS.items()
        if name != "id"
    },
    border_geometry=(Geometry | None, None),
)


def _to_api_bed(row: BedTable) -> Bed:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"border_geometry"})
    return Bed(**data, border_geometry=parse_geometry(row.border_geometry))


def _get_or_404(session: Session, bed_id: int) -> BedTable:
    bed = session.get(BedTable, bed_id)
    if bed is None:
        raise HTTPException(status_code=404, detail=f"No bed with id {bed_id}")
    return bed


@router.get("", response_model=list[Bed])
def list_beds(session: Session = Depends(get_session)) -> list[Bed]:  # type: ignore[valid-type]
    rows = list(session.exec(select(BedTable)).all())
    return [_to_api_bed(row) for row in rows]


@router.get("/{bed_id}", response_model=Bed)
def get_bed(bed_id: int, session: Session = Depends(get_session)) -> Bed:  # type: ignore[valid-type]
    return _to_api_bed(_get_or_404(session, bed_id))


@router.post("", response_model=Bed, status_code=201)
def create_bed(
    bed: _BedCreate,
    is_initial_state: bool = False,
    session: Session = Depends(get_session),
) -> Bed:  # type: ignore[valid-type]
    """is_initial_state: set when backfilling a bed that already exists in
    the real garden (modeling its pre-existing state), not when the
    gardener is actually adding one now - skips auto-generating a
    prepare_bed task (#192) so backfilling doesn't spam the task list with
    things that already happened."""
    data = bed.model_dump()
    row = BedTable(**data)
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    generate_bed_tasks(session, row, is_initial_state=is_initial_state)
    commit_or_409(session)
    # The commit above expires every attribute on `row` (SQLAlchemy's
    # default expire_on_commit=True) - _to_api_bed's model_dump() reads
    # straight from __dict__, not through SQLAlchemy's lazy-reloading
    # descriptors (same caveat app/api/routes/garden.py's put_garden
    # documents), so without this second refresh every field would come
    # back missing instead of reloaded.
    session.refresh(row)
    return _to_api_bed(row)


@router.patch("/{bed_id}", response_model=Bed)
def update_bed(
    bed_id: int, update: _BedUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Bed:  # type: ignore[valid-type]
    bed = _get_or_404(session, bed_id)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(bed, field, value)
    session.add(bed)
    commit_or_409(session)
    session.refresh(bed)
    return _to_api_bed(bed)


@router.delete("/{bed_id}", status_code=204)
def delete_bed(
    bed_id: int, cascade: bool = False, session: Session = Depends(get_session)
) -> None:
    bed = _get_or_404(session, bed_id)
    if cascade:
        # Actions first, before Planting/BedEquipment: #192's
        # auto-generated install_equipment tasks reference equipment_id, so
        # deleting equipment before the actions that reference it would
        # trip that FK the moment the equipment deletes autoflush (every
        # install_equipment/prepare_bed/sow/etc. task against this bed
        # already has bed_id set to this same bed - see
        # app/services/task_generation.py - so this one query also covers
        # equipment-referencing actions, not just bed-referencing ones).
        bed_actions = list(session.exec(select(Action).where(Action.bed_id == bed_id)).all())
        bed_action_ids = [action.id for action in bed_actions]
        if bed_action_ids:
            # Null out any depends_on_action_id (this bed's own, or another
            # bed's - #192's self-FK dependency isn't scoped to a single
            # bed) pointing at one of the actions about to be deleted,
            # before deleting them - otherwise a still-referencing row
            # would trip the FK constraint on the flush below.
            for dependent in session.exec(
                select(Action).where(Action.depends_on_action_id.in_(bed_action_ids))
            ).all():
                dependent.depends_on_action_id = None
        for action in bed_actions:
            session.delete(action)
        for planting in session.exec(select(Planting).where(Planting.bed_id == bed_id)).all():
            session.delete(planting)
        for equipment in session.exec(
            select(BedEquipment).where(BedEquipment.bed_id == bed_id)
        ).all():
            session.delete(equipment)
        # Same gap as Planting/BedEquipment above, found by tester while
        # testing #38/#39: these two are also plain-FK-only satellite
        # tables on bed_id (CompostFertilizationLog per #38,
        # CompostBin per #39 - see each model's own docstring), so they
        # need the same explicit cleanup here or a bed with any logged
        # compost/fertilization history, or one marked as a compost bin,
        # could never be deleted at all (cascade or not).
        for log in session.exec(
            select(CompostFertilizationLog).where(CompostFertilizationLog.bed_id == bed_id)
        ).all():
            session.delete(log)
        for compost_bin in session.exec(
            select(CompostBin).where(CompostBin.bed_id == bed_id)
        ).all():
            session.delete(compost_bin)
        # No SQLAlchemy `relationship()` links Bed to Planting/BedEquipment/
        # CompostFertilizationLog/CompostBin (plain FK columns only - see
        # each model's own docstring), so the ORM's unit-of-work has no
        # dependency info to order these deletes against the bed's own
        # delete below; without an explicit flush here it can (and did,
        # verified against garden_test) emit the bed's DELETE first and hit
        # the FK constraint it's trying to avoid.
        session.flush()
    session.delete(bed)
    commit_or_409(session)
