from enum import Enum

from sqlmodel import Field, SQLModel


class SunLevel(str, Enum):
    full_sun = "full_sun"
    half_sun = "half_sun"
    shadow = "shadow"


class PeriodType(str, Enum):
    sowing = "sowing"
    planting = "planting"
    fertilizing = "fertilizing"
    harvesting = "harvesting"


class CompanionRelationship(str, Enum):
    good = "good"
    bad = "bad"


class Plant(SQLModel, table=True):
    slug: str = Field(primary_key=True)
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


class PlantDataSource(SQLModel, table=True):
    __tablename__ = "plant_data_source"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    source_url: str | None = None
    attribution: str | None = None
    notes: str | None = None


class SeedInfo(SQLModel, table=True):
    __tablename__ = "seed_info"

    plant_slug: str = Field(primary_key=True, foreign_key="plant.slug")
    seeds_per_gram: float | None = None
    pretreatment: str | None = None
    produces_viable_seeds: bool | None = None
    is_f1_hybrid: bool | None = None


class PlantPeriod(SQLModel, table=True):
    __tablename__ = "plant_period"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    period_type: PeriodType
    # Month-only (1-12), not a calendar date: these are species-level windows
    # that recur every year (e.g. "sow Feb-Mar"), not a one-off event tied to
    # a specific year - that's what BedPlanting/Action dates are for.
    start_month: int
    end_month: int


class PlantCompanion(SQLModel, table=True):
    __tablename__ = "plant_companion"

    plant_slug: str = Field(primary_key=True, foreign_key="plant.slug")
    companion_plant_slug: str = Field(primary_key=True, foreign_key="plant.slug")
    relationship: CompanionRelationship
    notes: str | None = None


class PlantBeddingNeed(SQLModel, table=True):
    __tablename__ = "plant_bedding_need"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    # Open-ended (ground_cover | hilling | staking | ...) per the domain
    # model - not a closed enum like SunLevel/PeriodType.
    need_type: str
    notes: str | None = None
