from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.plant import SunLevel


class Bed(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    # Free-text, not a closed enum - was bed_type (large_planter|small_planter|
    # berry_row|compost_bin|fruit_tree) until real usage showed those were
    # only ever meant as examples of what a planter could be, not an
    # exhaustive category list. Users need to model arbitrary planters.
    category: str | None = None
    # jsonb rectangle|polygon, garden-space cm - see app/models/geometry.py
    # and docs/schema.md's "Geometry format". Raw dict at the table level;
    # validated into Geometry at the API boundary (routes/beds.py), same
    # split every other jsonb geometry column in this app uses.
    border_geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    height_cm: float = 0  # "raised" is derived as height_cm > 0, not its own column (removed is_raised)
    has_greenhouse: bool = False
    # orientation (free-text N/SE/etc. compass label) removed 2026-07-20 (#75):
    # superseded once bed rotation became garden-relative (#68) off of the
    # garden's own Garden.orientation_deg (#69) - a separate free-text field
    # on Bed was redundant once that landed. Shade-casting reasoning per root
    # CLAUDE.md's domain notes should derive orientation from border_geometry's
    # rotation relative to the garden instead, not from this field.
    soil_type: str | None = None
    sun_level: SunLevel | None = None
    notes: str = ""
