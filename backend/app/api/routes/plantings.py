from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.geometry import Geometry, parse_geometry
from app.models.planting import Planting as PlantingTable
from app.services.task_generation import generate_clear_task, generate_planting_tasks

router = APIRouter(prefix="/plantings", tags=["plantings"])

# Same split as beds.py/garden.py: geometry is a raw dict at the table
# level, typed as Geometry only at the API boundary.
_PLANTING_TABLE_FIELDS = {name: field for name, field in PlantingTable.model_fields.items() if name != "geometry"}


def _planting_field_tuple(field):
    if field.is_required():
        return (field.annotation, ...)
    return (field.annotation, field.default)


Planting = create_model(
    "Planting",
    __base__=BaseModel,
    **{name: _planting_field_tuple(field) for name, field in _PLANTING_TABLE_FIELDS.items()},
    geometry=(Geometry, ...),
)

_PlantingCreate = create_model(
    "PlantingCreate",
    __base__=BaseModel,
    **{name: _planting_field_tuple(field) for name, field in _PLANTING_TABLE_FIELDS.items() if name != "id"},
    geometry=(Geometry, ...),
)

_PlantingUpdate = create_model(
    "PlantingUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _PLANTING_TABLE_FIELDS.items()
        if name != "id"
    },
    geometry=(Geometry | None, None),
)


def _to_api_planting(row: PlantingTable) -> Planting:  # type: ignore[valid-type]
    data = row.model_dump(exclude={"geometry"})
    return Planting(**data, geometry=parse_geometry(row.geometry))


def _get_or_404(session: Session, planting_id: int) -> PlantingTable:
    planting = session.get(PlantingTable, planting_id)
    if planting is None:
        raise HTTPException(status_code=404, detail=f"No planting with id {planting_id}")
    return planting


@router.get("", response_model=list[Planting])
def list_plantings(session: Session = Depends(get_session)) -> list[Planting]:  # type: ignore[valid-type]
    rows = list(session.exec(select(PlantingTable)).all())
    return [_to_api_planting(row) for row in rows]


@router.get("/{planting_id}", response_model=Planting)
def get_planting(planting_id: int, session: Session = Depends(get_session)) -> Planting:  # type: ignore[valid-type]
    return _to_api_planting(_get_or_404(session, planting_id))


@router.post("", response_model=Planting, status_code=201)
def create_planting(
    planting: _PlantingCreate,
    is_initial_state: bool = False,
    started_from_seed: bool = True,
    session: Session = Depends(get_session),
) -> Planting:  # type: ignore[valid-type]
    """is_initial_state: set when backfilling a planting that already
    exists in the real garden, not when the gardener is placing one now -
    skips auto-generating sow/plant/fertilize/harvest tasks (#192) so
    backfilling doesn't spam the task list with things that already
    happened. started_from_seed: whether the gardener is sowing seed
    (default) or planting an already-started plant they bought - a bought
    started plant never gets a sow task, only whichever of
    plant/fertilize/harvest apply. Neither flag is persisted on the
    Planting row itself, both only decide which Actions get generated for
    this one create call."""
    row = PlantingTable(**planting.model_dump())
    session.add(row)
    commit_or_409(session)
    session.refresh(row)
    generate_planting_tasks(
        session, row, is_initial_state=is_initial_state, started_from_seed=started_from_seed
    )
    generate_clear_task(session, row, is_initial_state=is_initial_state)
    commit_or_409(session)
    # See beds.py's create_bed for why this second refresh is needed - the
    # commit above expires row's attributes, and _to_api_planting's
    # model_dump() reads straight from __dict__, not through SQLAlchemy's
    # lazy-reloading descriptors.
    session.refresh(row)
    return _to_api_planting(row)


@router.patch("/{planting_id}", response_model=Planting)
def update_planting(
    planting_id: int, update: _PlantingUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Planting:  # type: ignore[valid-type]
    planting = _get_or_404(session, planting_id)
    changes = update.model_dump(exclude_unset=True)
    # geometry is always bed-local: moving a planting to a different bed
    # without supplying new coordinates would silently reinterpret the old
    # bed's coordinates against the new bed, which is meaningless.
    if "bed_id" in changes and changes["bed_id"] != planting.bed_id and "geometry" not in changes:
        raise HTTPException(
            status_code=400,
            detail="Changing bed_id requires a new geometry in the same request",
        )
    for field, value in changes.items():
        setattr(planting, field, value)
    session.add(planting)
    commit_or_409(session)
    session.refresh(planting)
    if "removed_date" in changes:
        # Setting removed_date is the real-world "this got cleared" event -
        # generate/attach the matching clear task (#192), collapsed to that
        # single day. No is_initial_state flag here - unlike create, a
        # PATCH is always an explicit, in-the-moment action by the
        # gardener, not a backfill.
        generate_clear_task(session, planting)
        commit_or_409(session)
        session.refresh(planting)
    return _to_api_planting(planting)


@router.delete("/{planting_id}", status_code=204)
def delete_planting(planting_id: int, session: Session = Depends(get_session)) -> None:
    planting = _get_or_404(session, planting_id)
    session.delete(planting)
    commit_or_409(session)
