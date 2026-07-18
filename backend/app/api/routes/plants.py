from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, delete, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.plant import (
    LifeCycle,
    Plant,
    PlantBeddingNeed,
    PlantCompanion,
    PlantDataSource,
    PlantGrowingInformation,
    PlantPeriod,
    PlantPestInteraction,
    SeedInfo,
    SunLevel,
)

router = APIRouter(prefix="/plants", tags=["plants"])

# Built from Plant's own fields (everything but the slug identity) rather
# than retyped by hand, so a future field added to Plant is automatically
# patchable here too instead of silently staying stuck at its create-time
# value until someone remembers to update this list.
_PlantUpdate = create_model(
    "PlantUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in Plant.model_fields.items()
        if name != "slug"
    },
)


class PlantDetail(BaseModel):
    """GET /plants/{slug} response: the plant plus every satellite row,
    mirroring the shape of a data/plants/<slug>.json export. list_plants
    stays flat (just Plant) since assembling this for 359 rows on every
    list call would be wasted work most callers don't need.

    Not `class PlantDetail(Plant)`: SQLModel's metaclass tries to turn every
    added field into a table column even on a subclass without its own
    table=True, and list[SomeOtherTable] has no matching column type - the
    fields are duplicated here as a plain BaseModel instead."""

    slug: str
    common_name: str
    botanical_name: str
    description: str | None = None
    sowing_method: str | None = None
    spread_cm: float | None = None
    row_spacing_cm: float | None = None
    height_cm: float | None = None
    sun_level: SunLevel | None = None
    soil_type: str | None = None
    composting_needs: str | None = None
    fertilizer_needs: str | None = None
    needs_wind_cover: bool | None = None
    needs_rain_cover: bool | None = None
    water_needs: str | None = None
    family: str | None = None
    genus: str | None = None
    min_temperature_c: float | None = None
    max_temperature_c: float | None = None
    days_to_maturity: int | None = None
    soil_ph_min: float | None = None
    soil_ph_max: float | None = None
    is_toxic: bool | None = None
    toxicity_notes: str | None = None
    is_edible: bool | None = None
    edible_parts: list[str] | None = None
    succession_enabled: bool | None = None
    succession_interval_days: int | None = None
    succession_max_sowings: int | None = None
    life_cycle: LifeCycle | None = None
    life_cycle_years: int | None = None

    data_sources: list[PlantDataSource] = []
    seed_info: SeedInfo | None = None
    periods: list[PlantPeriod] = []
    companions: list[PlantCompanion] = []
    bedding_needs: list[PlantBeddingNeed] = []
    pest_interactions: list[PlantPestInteraction] = []
    growing_information: list[PlantGrowingInformation] = []


def _get_plant_or_404(session: Session, slug: str) -> Plant:
    plant = session.get(Plant, slug)
    if plant is None:
        raise HTTPException(status_code=404, detail=f"No plant with slug {slug!r}")
    return plant


@router.get("", response_model=list[Plant])
def list_plants(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> list[Plant]:
    return list(session.exec(select(Plant).offset(offset).limit(limit)).all())


@router.get("/{slug}", response_model=PlantDetail)
def get_plant(slug: str, session: Session = Depends(get_session)) -> PlantDetail:
    plant = _get_plant_or_404(session, slug)
    return PlantDetail(
        **plant.model_dump(),
        data_sources=list(
            session.exec(select(PlantDataSource).where(PlantDataSource.plant_slug == slug)).all()
        ),
        seed_info=session.get(SeedInfo, slug),
        periods=list(session.exec(select(PlantPeriod).where(PlantPeriod.plant_slug == slug)).all()),
        companions=list(
            session.exec(select(PlantCompanion).where(PlantCompanion.plant_slug == slug)).all()
        ),
        bedding_needs=list(
            session.exec(select(PlantBeddingNeed).where(PlantBeddingNeed.plant_slug == slug)).all()
        ),
        pest_interactions=list(
            session.exec(
                select(PlantPestInteraction).where(PlantPestInteraction.plant_slug == slug)
            ).all()
        ),
        growing_information=list(
            session.exec(
                select(PlantGrowingInformation).where(PlantGrowingInformation.plant_slug == slug)
            ).all()
        ),
    )


@router.post("", response_model=Plant, status_code=201)
def create_plant(plant: Plant, session: Session = Depends(get_session)) -> Plant:
    if session.get(Plant, plant.slug) is not None:
        raise HTTPException(status_code=409, detail=f"Plant {plant.slug!r} already exists")
    session.add(plant)
    commit_or_409(session)
    session.refresh(plant)
    return plant


@router.patch("/{slug}", response_model=Plant)
def update_plant(
    slug: str, update: _PlantUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Plant:
    plant = _get_plant_or_404(session, slug)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(plant, field, value)
    session.add(plant)
    commit_or_409(session)
    session.refresh(plant)
    return plant


@router.delete("/{slug}", status_code=204)
def delete_plant(slug: str, session: Session = Depends(get_session)) -> None:
    _get_plant_or_404(session, slug)
    # No ON DELETE CASCADE at the DB level - clear every satellite row
    # (including plant_companion rows where this plant is only the
    # *target*, companion_plant_slug, not the owning plant_slug) before
    # the plant itself, same delete-then-reinsert spirit import_plants.py
    # already uses.
    for model in (
        PlantDataSource,
        SeedInfo,
        PlantPeriod,
        PlantBeddingNeed,
        PlantPestInteraction,
        PlantGrowingInformation,
    ):
        session.exec(delete(model).where(model.plant_slug == slug))
    session.exec(delete(PlantCompanion).where(PlantCompanion.plant_slug == slug))
    session.exec(delete(PlantCompanion).where(PlantCompanion.companion_plant_slug == slug))
    session.exec(delete(Plant).where(Plant.slug == slug))
    commit_or_409(session)


def _register_satellite_routes(path: str, model: type[Any], name: str) -> None:
    """Registers GET list / POST create / DELETE {id} under /plants/{slug}/{path}
    for a satellite table shaped like (int id PK, plant_slug FK, ...) - the
    shape shared by data_sources, periods, bedding_needs, pest_interactions,
    and growing_information. Avoids five near-identical copies of the same
    three handlers; companions and seed_info have different PK shapes and
    are written out directly below instead."""

    @router.get(f"/{{slug}}/{path}", response_model=list[model], name=f"list_{name}")
    def list_items(slug: str, session: Session = Depends(get_session)) -> list[model]:
        _get_plant_or_404(session, slug)
        return list(session.exec(select(model).where(model.plant_slug == slug)).all())

    @router.post(f"/{{slug}}/{path}", response_model=model, status_code=201, name=f"create_{name}")
    def create_item(slug: str, item: model, session: Session = Depends(get_session)) -> Any:
        _get_plant_or_404(session, slug)
        item.id = None
        item.plant_slug = slug
        session.add(item)
        commit_or_409(session)
        session.refresh(item)
        return item

    @router.delete(f"/{{slug}}/{path}/{{item_id}}", status_code=204, name=f"delete_{name}")
    def delete_item(slug: str, item_id: int, session: Session = Depends(get_session)) -> None:
        item = session.get(model, item_id)
        if item is None or item.plant_slug != slug:
            raise HTTPException(status_code=404, detail=f"No such {name} on plant {slug!r}")
        session.delete(item)
        session.commit()


_register_satellite_routes("data-sources", PlantDataSource, "data_source")
_register_satellite_routes("periods", PlantPeriod, "period")
_register_satellite_routes("bedding-needs", PlantBeddingNeed, "bedding_need")
_register_satellite_routes("pest-interactions", PlantPestInteraction, "pest_interaction")
_register_satellite_routes("growing-information", PlantGrowingInformation, "growing_information")


@router.get("/{slug}/companions", response_model=list[PlantCompanion])
def list_companions(slug: str, session: Session = Depends(get_session)) -> list[PlantCompanion]:
    _get_plant_or_404(session, slug)
    return list(session.exec(select(PlantCompanion).where(PlantCompanion.plant_slug == slug)).all())


@router.post("/{slug}/companions", response_model=PlantCompanion, status_code=201)
def create_companion(
    slug: str, item: PlantCompanion, session: Session = Depends(get_session)
) -> PlantCompanion:
    _get_plant_or_404(session, slug)
    item.plant_slug = slug
    session.add(item)
    commit_or_409(session)
    session.refresh(item)
    return item


@router.delete("/{slug}/companions/{companion_slug}", status_code=204)
def delete_companion(
    slug: str, companion_slug: str, session: Session = Depends(get_session)
) -> None:
    item = session.get(PlantCompanion, (slug, companion_slug))
    if item is None:
        raise HTTPException(status_code=404, detail="No such companion relationship")
    session.delete(item)
    session.commit()


@router.get("/{slug}/seed-info", response_model=SeedInfo)
def get_seed_info(slug: str, session: Session = Depends(get_session)) -> SeedInfo:
    item = session.get(SeedInfo, slug)
    if item is None:
        raise HTTPException(status_code=404, detail=f"No seed info for plant {slug!r}")
    return item


@router.put("/{slug}/seed-info", response_model=SeedInfo)
def upsert_seed_info(
    slug: str, item: SeedInfo, session: Session = Depends(get_session)
) -> SeedInfo:
    _get_plant_or_404(session, slug)
    item.plant_slug = slug
    session.merge(item)
    commit_or_409(session)
    return session.get(SeedInfo, slug)  # type: ignore[return-value]


@router.delete("/{slug}/seed-info", status_code=204)
def delete_seed_info(slug: str, session: Session = Depends(get_session)) -> None:
    item = session.get(SeedInfo, slug)
    if item is not None:
        session.delete(item)
        session.commit()
