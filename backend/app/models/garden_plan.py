from sqlmodel import Field, SQLModel


class GardenPlan(SQLModel, table=True):
    """A season/year's plant wishlist - a plan header (see GardenPlanEntry
    below for the line items). Distinct from Planting: a plan is intent
    ("I want to grow N tomatoes this year"), not yet a placed plant with
    real bed-local geometry - see docs/schema.md's GARDEN_PLAN sketch."""

    __tablename__ = "garden_plan"

    id: int | None = Field(default=None, primary_key=True)
    # Multi-garden support (#238) - nullable, same reasoning as Bed.garden_id
    # (see that model's own docstring): resolved server-side to whichever
    # Garden is active when not supplied explicitly, existing rows stay
    # valid without a backfill.
    garden_id: int | None = Field(default=None, foreign_key="garden.id")
    season_name: str
    year: int
    notes: str = ""


class GardenPlanEntry(SQLModel, table=True):
    """One line item on a GardenPlan: a desired plant + quantity, optionally
    assigned to a specific bed. bed_id is nullable - an entry can exist
    before its bed assignment is decided (docs/schema.md marks it "optional
    - not yet assigned"). Promoting an entry to a real Planting (with
    geometry, in the layout editor) is a natural follow-on interaction, not
    something this table does itself."""

    __tablename__ = "garden_plan_entry"

    id: int | None = Field(default=None, primary_key=True)
    garden_plan_id: int = Field(foreign_key="garden_plan.id")
    plant_slug: str = Field(foreign_key="plant.slug")
    bed_id: int | None = Field(default=None, foreign_key="bed.id")
    desired_quantity: int
    notes: str = ""
