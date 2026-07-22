from enum import Enum

from sqlalchemy import ARRAY, Column, String
from sqlmodel import Field, SQLModel


class SunLevel(str, Enum):
    full_sun = "full_sun"
    half_sun = "half_sun"
    shadow = "shadow"


class CompanionRelationship(str, Enum):
    good = "good"
    bad = "bad"


class PestInteractionType(str, Enum):
    attracts = "attracts"
    repels = "repels"
    vulnerable_to = "vulnerable_to"


class GrowingInfoRecordType(str, Enum):
    raw = "raw"
    consolidated = "consolidated"


class LifeCycle(str, Enum):
    annual = "annual"
    biennial = "biennial"
    perennial = "perennial"


class Family(SQLModel, table=True):
    """Normalized taxonomy lookup (was a free-text string on Plant) - gives
    referential integrity for family names and somewhere to hang per-family
    data later (e.g. rotation cooldown periods), per the domain notes on
    family-based rotation logic below."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)


class Genus(SQLModel, table=True):
    """Normalized taxonomy lookup, same rationale as Family. family_id is
    nullable rather than required: a source can give us a genus without a
    family (or with one that disagrees with what's already on file for that
    genus) - find_or_create_genus (app/services/taxonomy.py) deliberately
    doesn't overwrite an existing genus's family_id, so this stays whatever
    it was first set to until a deliberate data-cleanup pass reconciles it."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    family_id: int | None = Field(default=None, foreign_key="family.id")


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
    water_needs_mm_per_week: float | None = None
    # Free text (e.g. "vining", "bushy", "upright", "spreading") - no fixed
    # enum exists for the habit vocabulary populate_growth_habit.py already
    # produced across data/plants/*.json, same style as soil_type/
    # composting_needs above. Intended to eventually drive a realistic
    # per-plant footprint in the layout editor instead of a generic circle.
    growth_habit: str | None = None

    # Taxonomy - needed for family-based rotation/succession logic (see root
    # CLAUDE.md's domain notes). botanical_name usually encodes genus in its
    # first word, but these are kept as separate structured fields so
    # rotation queries don't have to parse it back out. FKs into Family/Genus
    # (above), not free-text - see app/services/taxonomy.py for the
    # find-or-create resolution the API layer does from plain name strings.
    family_id: int | None = Field(default=None, foreign_key="family.id")
    genus_id: int | None = Field(default=None, foreign_key="genus.id")

    # Cultivar-to-species linkage (#110): a nullable self-referencing FK
    # rather than a separate Cultivar entity or an inheritance/override-
    # resolution layer - see #64's design-decision comment. Every cultivar
    # stays a full Plant row (matches how the ETL already stores them, see
    # data/etl/CLAUDE.md's cultivar-merge fix); this column adds the
    # hierarchy on top ("all cultivars of tomato" = WHERE parent_plant_slug
    # = 'tomato') without duplicating/migrating anything else.
    parent_plant_slug: str | None = Field(default=None, foreign_key="plant.slug")

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

    # life_cycle classifies annual/biennial/perennial as usual; life_cycle_years
    # is a separate, independent field for a perennial's typical productive
    # lifespan (e.g. raspberry canes are perennial but a patch is usually
    # renewed after ~7 years) - not a 4th life_cycle value, since "perennial
    # with a known productive span" and "perennial" aren't mutually exclusive.
    life_cycle: LifeCycle | None = None
    life_cycle_years: int | None = None


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


class PeriodType(SQLModel, table=True):
    """Lookup table, not a fixed enum: sowing/planting/fertilizing/harvesting
    cover today's needs, but plant care can call for more period types than
    can be predicted up front (e.g. pruning, thinning, mulching windows) -
    a new row here is enough to support one, no migration required."""

    __tablename__ = "period_type"

    code: str = Field(primary_key=True)
    description: str | None = None


class PlantPeriod(SQLModel, table=True):
    __tablename__ = "plant_period"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    period_type: str = Field(foreign_key="period_type.code")
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


class PlantGrowingInformation(SQLModel, table=True):
    """Long-form growing-advice text (e.g. Project Gutenberg books with a
    section per plant) - deliberately unstructured, unlike every other
    field on Plant. The intent is to later extract structured values
    (composting_needs, fertilizer_needs, needs_wind_cover/rain_cover,
    seed_info.pretreatment, bedding_needs - the fields no structured source
    covers, see data/CLAUDE.md) out of this text; that extraction pass
    isn't built yet, this table just holds the raw material for it."""

    __tablename__ = "plant_growing_information"

    id: int | None = Field(default=None, primary_key=True)
    plant_slug: str = Field(foreign_key="plant.slug")
    text: str
    source_url: str | None = None
    attribution: str | None = None
    # Free text, not a closed enum - old book scans are usually public
    # domain, but sources vary a lot ("public domain", "CC BY-SA 4.0",
    # "unknown").
    copyright_status: str | None = None
    record_type: GrowingInfoRecordType = GrowingInfoRecordType.raw
    # Some sources describe a species/genus generically (e.g. "pumpkins")
    # rather than this specific cultivar. The text still gets copied into
    # every matching cultivar's own record (per-cultivar records are the
    # whole point after the Cucurbita pepo merge bug - see
    # data/etl/CLAUDE.md) but flagged here so it's not mistaken for
    # cultivar-specific advice.
    generic_for_species: bool | None = None
