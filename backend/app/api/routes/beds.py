from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlalchemy import or_
from sqlmodel import Session, select, update

from app.api.deps import commit_or_409, get_active_garden
from app.core.db import get_session
from app.models.action import Action
from app.models.bed import Bed as BedTable
from app.models.bed_equipment import BedEquipment
from app.models.compost_bin import CompostBin
from app.models.compost_fertilization_log import CompostFertilizationLog
from app.models.geometry import Geometry, parse_geometry
from app.models.harvest_log import HarvestLog
from app.models.planting import Planting
from app.models.soil_rotation import SoilFamilyHistory, SoilRotationTransfer
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
    # #258: scoped to whichever garden is currently active - unfiltered only
    # when no Garden exists at all yet (get_active_garden returns None),
    # same as every list route before multi-garden support existed.
    query = select(BedTable)
    active_garden = get_active_garden(session)
    if active_garden is not None:
        query = query.where(BedTable.garden_id == active_garden.id)
    rows = list(session.exec(query).all())
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
    # #238: resolve garden_id server-side against whichever garden is
    # currently active, but only when the client didn't supply one
    # explicitly (model_fields_set, not just "is it None") - and only when
    # a garden actually exists (get_active_garden returns None otherwise,
    # same as if this field never existed, for every flow that predates
    # multi-garden support).
    if "garden_id" not in bed.model_fields_set:
        active_garden = get_active_garden(session)
        if active_garden is not None:
            data["garden_id"] = active_garden.id
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


def cascade_delete_bed_dependents(session: Session, bed_ids: list[int]) -> None:
    """Gathers and deletes every dependent row one or more Beds can have
    (Actions, Plantings, HarvestLogs, BedEquipment, CompostFertilizationLog,
    CompostBin, SoilFamilyHistory, SoilRotationTransfer) - shared by
    delete_bed's own cascade=true path (a single-element list) and
    app/api/routes/garden.py's delete_active_garden (#218), which needs the
    exact same cleanup for every Bed under a Garden being deleted
    (potentially several at once). Does NOT delete the Bed row(s)
    themselves or flush - callers own that.

    #215/#217: both were the same class of bug - SQLAlchemy's default
    autoflush=True means any SELECT issued *after* a session.delete() has
    already been queued can silently flush that pending delete out of
    order (or, for the #215 case, drop an attribute mutation on an object
    also pending deletion) and hit a real FK violation before
    commit_or_409's try/except ever gets a chance to catch it - it only
    wraps the final explicit commit, not any earlier implicit flush. Fixed
    structurally here, not per-table: every dependent row is gathered via
    SELECT *first*, before a single session.delete() call - no SELECT ever
    runs once deletion starts, so there's nothing left to autoflush out of
    order. Callers passing more than one bed_id must gather everything
    *they* need via SELECT before calling this too, for the same reason -
    this function's own internal SELECTs would otherwise autoflush
    whatever the caller already queued for deletion.
    """
    if not bed_ids:
        return
    bed_actions = list(session.exec(select(Action).where(Action.bed_id.in_(bed_ids))).all())
    bed_action_ids = [action.id for action in bed_actions]
    plantings = list(session.exec(select(Planting).where(Planting.bed_id.in_(bed_ids))).all())
    planting_ids = [planting.id for planting in plantings]
    # #217: HarvestLog references planting_id with no ON DELETE CASCADE and
    # (like every other satellite table here) no relationship() - a bed
    # with a logged harvest against one of its plantings couldn't be
    # cascade-deleted at all before this, 500ing instead of the clean
    # 204/409 every other dependent table already gets.
    harvest_logs = (
        list(session.exec(select(HarvestLog).where(HarvestLog.planting_id.in_(planting_ids))).all())
        if planting_ids
        else []
    )
    # install_equipment tasks reference equipment_id (every
    # install_equipment/prepare_bed/sow/etc. task against a bed already has
    # bed_id set to that same bed - see app/services/task_generation.py -
    # so bed_actions above already covers equipment-referencing actions
    # too, not just bed-referencing ones).
    equipment_rows = list(session.exec(select(BedEquipment).where(BedEquipment.bed_id.in_(bed_ids))).all())
    # CompostFertilizationLog (#38) and CompostBin (#39) are also
    # plain-FK-only satellite tables on bed_id - a bed with any logged
    # compost/fertilization history, or one marked as a compost bin, needs
    # the same explicit cleanup or it could never be deleted at all
    # (cascade or not).
    compost_logs = list(
        session.exec(select(CompostFertilizationLog).where(CompostFertilizationLog.bed_id.in_(bed_ids))).all()
    )
    compost_bins = list(session.exec(select(CompostBin).where(CompostBin.bed_id.in_(bed_ids))).all())
    # #228: SoilFamilyHistory.bed_id is the bed whose *current* soil a fact
    # travels with - a real FK, same as every other satellite table here.
    # SoilRotationTransfer.from_bed_id/to_bed_id reference a bed via either
    # side of a rotation edge - deleting a bed that's ever been part of a
    # logged rotation event (as either side) loses that specific edge's
    # history, same already-accepted trade-off cascade=true makes for every
    # other dependent table (a cascade delete is explicitly destructive).
    # The parent SoilRotationEvent row itself is deliberately left alone
    # even if this empties it of every transfer - harmless (nothing
    # references it *from* Bed), not worth the extra bookkeeping.
    soil_family_history_rows = list(
        session.exec(select(SoilFamilyHistory).where(SoilFamilyHistory.bed_id.in_(bed_ids))).all()
    )
    soil_rotation_transfers = list(
        session.exec(
            select(SoilRotationTransfer).where(
                or_(SoilRotationTransfer.from_bed_id.in_(bed_ids), SoilRotationTransfer.to_bed_id.in_(bed_ids))
            )
        ).all()
    )

    if bed_action_ids:
        # Null out any depends_on_action_id (one of these beds' own, or
        # another bed's - #192's self-FK dependency isn't scoped to a
        # single bed) pointing at one of the actions about to be deleted,
        # before deleting them - otherwise a still-referencing row would
        # trip the FK constraint on the flush below.
        #
        # #215: a real bulk UPDATE, not "load the dependent Action rows via
        # the ORM and mutate the attribute" - the common case is a bed's
        # own `sow` Action depending on that same bed's own `prepare_bed`
        # Action (both already in bed_actions, about to be deleted below).
        # SQLAlchemy's unit-of-work never emits a separate UPDATE for an
        # object that's also pending deletion in the same flush - the
        # DELETE supersedes it, so the attribute mutation was silently
        # dropped, and Action.depends_on_action_id has no relationship()
        # (self-FK, same reasoning as every other satellite table here)
        # telling the unit-of-work it must order the sow delete before the
        # prepare_bed delete either. A genuine, separately-flushed
        # statement sidesteps both problems. This runs before any
        # session.delete() below, so it can't itself trigger an
        # out-of-order autoflush.
        session.exec(
            update(Action)
            .where(Action.depends_on_action_id.in_(bed_action_ids))
            .values(depends_on_action_id=None)
        )
    for harvest_log in harvest_logs:
        session.delete(harvest_log)
    for action in bed_actions:
        session.delete(action)
    for planting in plantings:
        session.delete(planting)
    for equipment in equipment_rows:
        session.delete(equipment)
    for log in compost_logs:
        session.delete(log)
    for compost_bin in compost_bins:
        session.delete(compost_bin)
    for history_row in soil_family_history_rows:
        session.delete(history_row)
    for transfer_row in soil_rotation_transfers:
        session.delete(transfer_row)


@router.delete("/{bed_id}", status_code=204)
def delete_bed(
    bed_id: int, cascade: bool = False, session: Session = Depends(get_session)
) -> None:
    bed = _get_or_404(session, bed_id)
    if cascade:
        cascade_delete_bed_dependents(session, [bed_id])
        # No SQLAlchemy `relationship()` links Bed to Planting/BedEquipment/
        # CompostFertilizationLog/CompostBin/HarvestLog (plain FK columns
        # only - see each model's own docstring), so the ORM's unit-of-work
        # has no dependency info to order these deletes against the bed's
        # own delete below; without an explicit flush here it can (and did,
        # verified against garden_test) emit the bed's DELETE first and hit
        # the FK constraint it's trying to avoid.
        session.flush()
    session.delete(bed)
    commit_or_409(session)
