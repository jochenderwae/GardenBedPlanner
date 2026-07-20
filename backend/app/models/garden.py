from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Garden(SQLModel, table=True):
    """The overarching garden itself - its own boundary geometry, plus the
    climate/location settings the domain model originally sketched as a
    separate GARDEN_SETTINGS singleton (folded in here since both are
    naturally overarching, singleton-ish concerns). Not DB-enforced as a
    hard singleton (no unique constraint forcing exactly one row) - the API
    (app/api/routes/garden.py) exposes it as GET/PUT /api/garden, singular,
    which is what actually keeps it to one in practice.

    Multi-garden support (backlog: "Prepare the data model for eventually
    supporting multiple gardens") is explicitly *not* built here - this is
    a design note for whenever it is, not a schema change now. The table
    itself would tolerate more than one row today (no DB constraint stops
    it), but nothing downstream is ready to use that: (1) the API is
    GET/PUT singular with get-or-create semantics, not list-style CRUD, and
    has no notion of a "currently selected" garden; (2) Bed/Planting/
    BedEquipment have no garden_id FK at all - today there's no way to say
    which garden a bed belongs to, because there's only ever one; (3) the
    auto-created ground-level Bed this route creates on first Garden
    creation (see put_garden's docstring) is a one-time global default,
    not scoped per-garden - a real multi-garden version would need one
    ground bed per garden, tied to that garden's own id. Frontend would
    need a garden-switcher UI on top of all that. None of this is planned
    work yet, just the shape of what "yet" would require."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = "My Garden"
    # jsonb rectangle|polygon, same Geometry union as Bed.border_geometry -
    # see app/models/geometry.py.
    border_geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    climate_zone: str | None = None
    location: str | None = None
    # Compass bearing in degrees clockwise from true north (0-360), set via
    # the canvas editor's compass widget. Distinct from Bed.orientation
    # (a coarse free-text N/SE/etc. label for shade reasoning, not a
    # bearing) - this is the numeric value garden-relative bed rotation is
    # computed against. Defaults to 0.0 (north-up) rather than nullable, so
    # consumers never have to special-case "unset".
    orientation_deg: float = 0.0
    notes: str = ""
