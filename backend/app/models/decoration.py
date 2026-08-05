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
    yet (Garden is a singleton today). #266: that reasoning went stale once
    Bed itself gained garden_id (#238) and every other garden-owned list
    endpoint was scoped to the active garden (#258) - garden_id added below,
    same nullable-FK shape and same server-side-resolve-if-unset pattern as
    Bed.garden_id (app/api/routes/decorations.py's create_decoration)."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    # #266: nullable for the same reason as Bed.garden_id - existing rows
    # (or rows created outside the normal API) stay valid without a
    # backfill. POST /api/decorations resolves this server-side against
    # whichever Garden is currently active when the client doesn't supply
    # it explicitly.
    garden_id: int | None = Field(default=None, foreign_key="garden.id")
    color: str = "#78716c"  # hex, defaults to a neutral stone-gray preset swatch
    # jsonb rectangle|polygon, garden-space cm - see app/models/geometry.py.
    # Always set at creation time (the Add decoration dialog always draws a
    # default footprint) - not nullable the way BedEquipment.geometry is for
    # unplaced inventory, a decoration has no "unplaced" state.
    border_geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    notes: str = ""
