from enum import Enum

from sqlalchemy import ARRAY, Column, String
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


class PestInteractionType(str, Enum):
    attracts = "attracts"
    repels = "repels"
    vulnerable_to = "vulnerable_to"


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

    # Taxonomy - needed for family-based rotation/succession logic (see root
    # CLAUDE.md's domain notes). botanical_name usually encodes genus in its
    # first word, but these are kept as separate structured fields so
    # rotation queries don't have to parse it back out.
    family: str | None = None
    genus: str | None = None

    # Natural habitat temperature range, not a US hardiness zone - more
    # directly useful for adjusting to Belgium's climate (see root
    # CLAUDE.md's domain notes on weather/climate-adjusted planting).
    min_temperature_c: float | None = None
    max_temperature_c: float | None = None

    days_to_maturity: int | None = None
    soil_ph_min: float | None = None
    soil_ph_max: float | None = None

    is_toxic: bool | None = None
    toxicity_notes: str | None = None
    is_edible: bool | None = None
    edible_parts: list[str] | None = Field(
        default=None, sa_column=Column(ARRAY(String))
    )

    # Succession planting: whether/how this crop can be re-sown at intervals
    # through the season rather than once.
    succession_enabled: bool | None = None
    succession_interval_days: int | None = None
    succession_max_sowings: int | None = None


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
    # Open-ended (pest-deterrent | nitrogen-fixing | allelopathy | ...) - why
    # the relationship holds, not a closed enum.
    mechanism: str | None = None
    notes: str | None = None


class PlantBeddingNeed(SQLModel, table=True):
    __tablename__ = "plant_bedding_need"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    # Open-ended (ground_cover | hilling | staking | ...) per the domain
    # model - not a closed enum like SunLevel/PeriodType.
    need_type: str
    notes: str | None = None


class PlantPestInteraction(SQLModel, table=True):
    """Plant-to-insect relationships (attracts/repels/vulnerable_to) -
    distinct from PlantCompanion, which is plant-to-plant."""

    __tablename__ = "plant_pest_interaction"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    interaction_type: PestInteractionType
    # Free text (e.g. "aphids", "ladybugs", "tomato hornworm") - pest/insect
    # names aren't a fixed enum.
    pest_or_insect: str
    notes: str | None = None
