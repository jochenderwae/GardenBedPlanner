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
    which is what actually keeps it to one in practice."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = "My Garden"
    # jsonb rectangle|polygon, same Geometry union as Bed.border_geometry -
    # see app/models/geometry.py.
    border_geometry: dict = Field(sa_column=Column(JSONB, nullable=False))
    climate_zone: str | None = None
    location: str | None = None
    notes: str = ""
