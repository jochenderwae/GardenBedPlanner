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

    Multi-garden support (#238) is real as of 2026-08: exactly one garden is
    "active" at a time (`is_active`, a soft invariant enforced at the API
    layer - app/api/routes/garden.py's activate_garden - not a DB
    constraint, same pattern BedEquipment.bed_id/garden_id mutual
    exclusivity already uses). `GET/PUT /api/garden` (singular) now resolves
    to whichever garden is active rather than assuming there's only one;
    `GET/POST /api/gardens` + `GET/PATCH/DELETE /api/gardens/{id}` +
    `POST /api/gardens/{id}/activate` is the real list-style CRUD. `Bed` and
    `GardenPlan` carry a nullable `garden_id` FK (see each model's own
    docstring) - everything else (Planting, Action, HarvestLog, ...) keys
    off `bed_id` and is transitively scoped once `Bed` is, so no direct FK
    needed there. Garden deletion deliberately has no cascade path yet -
    refused (409) outright if it's the active garden or the only garden,
    matching this app's existing pattern of only building cascade-delete
    where a real, immediate need exists (see #217/#39's cascade-delete
    history). No combined cross-garden views/UI - single active garden at a
    time is the whole of this pass's scope."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = "My Garden"
    # Exactly one True at a time across every Garden row - enforced at the
    # API layer (app/api/routes/garden.py), not a DB constraint. The first
    # garden ever created is auto-activated; every later garden starts
    # False until explicitly activated via POST /api/gardens/{id}/activate.
    is_active: bool = False
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
