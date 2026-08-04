from datetime import date

from sqlmodel import Field, SQLModel


class SoilRotationEvent(SQLModel, table=True):
    """#228: Dave doesn't practice crop rotation between fixed beds -
    instead, every few years he physically moves topsoil between beds in a
    cycle (not necessarily just a two-way swap, not necessarily a closed
    loop). One row per "moving day" - the parent of however many
    SoilRotationTransfer edges that day involved. No PATCH/DELETE: a logged
    rotation event is a historical fact, not something users are expected
    to edit after the fact, matching how Planting.planted_date history
    isn't editable after the fact either, only appended to going forward."""

    __tablename__ = "soil_rotation_event"

    id: int | None = Field(default=None, primary_key=True)
    event_date: date
    notes: str = ""


class SoilRotationTransfer(SQLModel, table=True):
    """One edge in a rotation event's cycle - N rows under one
    SoilRotationEvent is how an N-way cycle (A->B->C->A, not just pairwise
    swaps) is represented, no special-casing beyond however many transfer
    rows the event has. from_bed_id is nullable: "fresh/external soil, not
    sourced from another tracked bed" (Dave's "empty the bed, fill it with
    new soil" case) folds into this same model as a transfer with no
    source, rather than needing a separate mechanism."""

    __tablename__ = "soil_rotation_transfer"

    id: int | None = Field(default=None, primary_key=True)
    soil_rotation_event_id: int = Field(foreign_key="soil_rotation_event.id")
    from_bed_id: int | None = Field(default=None, foreign_key="bed.id")
    to_bed_id: int = Field(foreign_key="bed.id")


class SoilFamilyHistory(SQLModel, table=True):
    """The derived summary that actually travels with a bed's soil, copied
    forward at rotation-event time (never mutated in place, only ever
    appended to) rather than reassigning the original Planting rows
    themselves - Planting.geometry is bed-local coordinates (#193) and
    #180's history rendering depends on bed_id/geometry staying physically
    accurate, so literally moving a Planting row to a different bed would
    corrupt that. bed_id is "the bed whose *current* soil this fact now
    travels with" - not where the plant was actually grown (that's still
    source_bed_id, kept purely for provenance/tooltip wording, see #229).

    Populated by app/services/soil_rotation.py's copy_forward_soil_history
    at event-creation time: for each transfer with a non-null from_bed_id,
    every family-risk fact from_bed_id currently holds (its own native
    Plantings *plus* any SoilFamilyHistory it already holds, so a soil
    that's moved more than once carries forward everything it picked up
    along the way) gets one new row here, tagged to to_bed_id."""

    __tablename__ = "soil_family_history"

    id: int | None = Field(default=None, primary_key=True)
    bed_id: int = Field(foreign_key="bed.id")
    family_id: int = Field(foreign_key="family.id")
    # Original planting date this fact derives from - used for
    # lookback_days filtering, exactly matching how check_rotation already
    # filters native Planting.planted_date.
    source_planted_date: date
    # Provenance for the warning tooltip's wording (#229) - not FKs on
    # purpose: source_bed_id may itself no longer hold this soil by the
    # time this row is read (it's a historical fact about where the risk
    # originated, not a live reference), and source_plant_slug is
    # display-only, same reasoning RotationWarning's own
    # conflicting_plant_slug isn't a live-joined FK either.
    source_bed_id: int
    source_plant_slug: str
    # Which event carried this fact forward, for audit purposes.
    soil_rotation_event_id: int = Field(foreign_key="soil_rotation_event.id")
