from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Decoration(SQLModel, table=True):
    """A purely cosmetic garden object (a path, bench, garden gnome, etc.) -
    a user-chosen render color, a drawn rectangle/polygon footprint, and a
    free-text name/description, carrying no functional data or app behavior
    otherwise (see #241). Deliberately the simplest table in the schema - no
    FKs to anything, and nothing else references it, so no cascade-delete
    concerns like Bed's (see delete_bed in app/api/routes/beds.py) ever
    apply here. No garden_id, matching Bed's own precedent of not having one
    yet (Garden is a singleton today)."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    color: str = "#78716c"  # hex, defaults to a neutral stone-gray preset swatch
    # jsonb rectangle|polygon, garden-space cm - see app/models/geometry.py.
    # Always set at creation time (the Add decoration dialog always draws a
    # default footprint) - not nullable the way BedEquipment.geometry is for
    # unplaced inventory, a decoration has no "unplaced" state.
    border_geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    notes: str = ""
