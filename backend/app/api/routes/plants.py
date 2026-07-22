from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, create_model
from sqlmodel import Session, delete, select

from app.api.deps import commit_or_409
from app.core.db import get_session
from app.models.plant import (
    Family,
    Genus,
    LifeCycle,
    Plant as PlantTable,
    PlantBeddingNeed,
    PlantCompanion,
    PlantDataSource,
    PlantGrowingInformation,
    PlantPeriod,
    PlantPestInteraction,
    SeedInfo,
    SunLevel,
)
from app.services.taxonomy import find_or_create_family, find_or_create_genus

router = APIRouter(prefix="/plants", tags=["plants"])


class FamilyRead(BaseModel):
    id: int
    name: str


class GenusRead(BaseModel):
    id: int
    name: str
    family_id: int | None = None


# Every PlantTable scalar field except the identity/taxonomy-FK columns -
# reused below to build the Plant/PlantDetail read schemas (which surface
# family/genus as nested read objects, not raw ids) and the create/update
# input schemas (which accept plain family/genus name strings instead,
# resolved via find_or_create_family/genus - see the handlers below) without
# retyping the field list by hand in four places.
_PLANT_TABLE_SCALAR_FIELDS = {
    name: field
    for name, field in PlantTable.model_fields.items()
    if name not in ("family_id", "genus_id")
}


# slug/common_name/botanical_name are the only non-nullable columns on
# PlantTable; everything else defaults to None there too, so this same set
# drives requiredness for both the Plant read schema and _PlantCreate below.
_REQUIRED_PLANT_FIELDS = {"slug", "common_name", "botanical_name"}


def _plant_field_tuple(name: str, field: Any) -> tuple[Any, Any]:
    if name in _REQUIRED_PLANT_FIELDS:
        return (field.annotation, ...)
    return (field.annotation | None, None)


# API read shape for a plant (list + create/update responses). Deliberately
# not `class Plant(PlantTable)`: SQLModel's metaclass turns every added
# field into a table column even on a subclass without its own table=True -
# built with create_model instead, same reasoning PlantDetail below
# documents for why its fields are hand-duplicated rather than subclassed.
Plant = create_model(
    "Plant",
    __base__=BaseModel,
    **{name: _plant_field_tuple(name, field) for name, field in _PLANT_TABLE_SCALAR_FIELDS.items()},
    family=(FamilyRead | None, None),
    genus=(GenusRead | None, None),
)


# Input schema for POST /plants: same fields/requiredness as the Plant read
# schema above, but family/genus are plain name strings rather than nested
# read objects - the API accepts taxonomy names, not database ids,
# resolving them server-side (see create_plant).
_PlantCreate = create_model(
    "PlantCreate",
    __base__=BaseModel,
    **{name: _plant_field_tuple(name, field) for name, field in _PLANT_TABLE_SCALAR_FIELDS.items()},
    family=(str | None, None),
    genus=(str | None, None),
)

# Built from Plant's own fields (everything but the slug identity and the
# taxonomy FKs) rather than retyped by hand, so a future field added to
# Plant is automatically patchable here too instead of silently staying
# stuck at its create-time value until someone remembers to update this
# list. family/genus are added back as plain name strings, same as
# _PlantCreate above.
_PlantUpdate = create_model(
    "PlantUpdate",
    __base__=BaseModel,
    **{
        name: (field.annotation | None, None)
        for name, field in _PLANT_TABLE_SCALAR_FIELDS.items()
        if name != "slug"
    },
    family=(str | None, None),
    genus=(str | None, None),
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
    water_needs_mm_per_week: float | None = None
    growth_habit: str | None = None
    family: FamilyRead | None = None
    genus: GenusRead | None = None
    parent_plant_slug: str | None = None
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


def _get_plant_or_404(session: Session, slug: str) -> PlantTable:
    plant = session.get(PlantTable, slug)
    if plant is None:
        raise HTTPException(status_code=404, detail=f"No plant with slug {slug!r}")
    return plant


def _load_family_genus_maps(
    session: Session, rows: list[PlantTable]
) -> tuple[dict[int, Family], dict[int, Genus]]:
    """Bulk-loads every Family/Genus a batch of plant rows references, so
    list_plants does two extra queries total instead of two per plant."""
    family_ids = {r.family_id for r in rows if r.family_id is not None}
    genus_ids = {r.genus_id for r in rows if r.genus_id is not None}
    families = (
        {f.id: f for f in session.exec(select(Family).where(Family.id.in_(family_ids))).all()}
        if family_ids
        else {}
    )
    genera = (
        {g.id: g for g in session.exec(select(Genus).where(Genus.id.in_(genus_ids))).all()}
        if genus_ids
        else {}
    )
    return families, genera


def _family_read(family: Family | None) -> FamilyRead | None:
    return FamilyRead(id=family.id, name=family.name) if family else None


def _genus_read(genus: Genus | None) -> GenusRead | None:
    return GenusRead(id=genus.id, name=genus.name, family_id=genus.family_id) if genus else None


def _to_api_plant(row: PlantTable, families: dict[int, Family], genera: dict[int, Genus]) -> Plant:
    data = row.model_dump(exclude={"family_id", "genus_id"})
    return Plant(
        **data,
        family=_family_read(families.get(row.family_id)) if row.family_id else None,
        genus=_genus_read(genera.get(row.genus_id)) if row.genus_id else None,
    )


@router.get("", response_model=list[Plant])
def list_plants(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> list[Plant]:
    rows = list(session.exec(select(PlantTable).offset(offset).limit(limit)).all())
    families, genera = _load_family_genus_maps(session, rows)
    return [_to_api_plant(row, families, genera) for row in rows]


@router.get("/{slug}", response_model=PlantDetail)
def get_plant(slug: str, session: Session = Depends(get_session)) -> PlantDetail:
    plant = _get_plant_or_404(session, slug)
    data = plant.model_dump(exclude={"family_id", "genus_id"})
    family = session.get(Family, plant.family_id) if plant.family_id else None
    genus = session.get(Genus, plant.genus_id) if plant.genus_id else None
    return PlantDetail(
        **data,
        family=_family_read(family),
        genus=_genus_read(genus),
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
def create_plant(payload: _PlantCreate, session: Session = Depends(get_session)) -> Plant:  # type: ignore[valid-type]
    if session.get(PlantTable, payload.slug) is not None:
        raise HTTPException(status_code=409, detail=f"Plant {payload.slug!r} already exists")
    data = payload.model_dump()
    family_id = find_or_create_family(session, data.pop("family"))
    genus_id = find_or_create_genus(session, data.pop("genus"), family_id)
    plant = PlantTable(**data, family_id=family_id, genus_id=genus_id)
    session.add(plant)
    commit_or_409(session)
    session.refresh(plant)
    families, genera = _load_family_genus_maps(session, [plant])
    return _to_api_plant(plant, families, genera)


@router.patch("/{slug}", response_model=Plant)
def update_plant(
    slug: str, update: _PlantUpdate, session: Session = Depends(get_session)  # type: ignore[valid-type]
) -> Plant:
    plant = _get_plant_or_404(session, slug)
    data = update.model_dump(exclude_unset=True)
    if "family" in data:
        plant.family_id = find_or_create_family(session, data.pop("family"))
    if "genus" in data:
        plant.genus_id = find_or_create_genus(session, data.pop("genus"), plant.family_id)
    for field, value in data.items():
        setattr(plant, field, value)
    session.add(plant)
    commit_or_409(session)
    session.refresh(plant)
    families, genera = _load_family_genus_maps(session, [plant])
    return _to_api_plant(plant, families, genera)


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
    session.exec(delete(PlantTable).where(PlantTable.slug == slug))
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
