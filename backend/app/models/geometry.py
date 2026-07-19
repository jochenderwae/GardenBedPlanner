"""Shared jsonb geometry shape for Bed/Garden/Planting/BedEquipment, per
docs/schema.md's "Geometry format" section - a small GeoJSON-flavored
discriminated union rather than a real PostGIS geometry/geography column
(single-user, no spatial queries, direct fit with react-konva).

Table columns store the raw dict (Postgres JSONB - see each model's
`sa_column=Column(JSONB)`); SQLAlchemy/SQLModel don't validate JSON column
contents, so validation of what's actually IN that dict happens here, at
the Pydantic/API boundary (request/response schemas), not in the DB.
`rotation` only applies to `rectangle` - polygon vertices already encode
any rotation directly, same as the doc specifies.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field


class Point2D(BaseModel):
    x: float
    y: float


class RectangleGeometry(BaseModel):
    type: Literal["rectangle"] = "rectangle"
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0


class PolygonGeometry(BaseModel):
    type: Literal["polygon"] = "polygon"
    points: list[Point2D]


Geometry = Annotated[RectangleGeometry | PolygonGeometry, Field(discriminator="type")]


def parse_geometry(data: dict) -> RectangleGeometry | PolygonGeometry:
    """Validates a raw jsonb dict (as read from a table row) into the typed
    union - use at the API boundary when building a response, mirroring how
    app/api/routes/plants.py resolves family_id/genus_id into read objects."""
    if data.get("type") == "polygon":
        return PolygonGeometry(**data)
    return RectangleGeometry(**data)
