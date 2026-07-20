import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.core.db import get_session
from app.models.geometry import Geometry
from app.models.plant import SunLevel
from app.scripts.import_example_garden import seed_example_garden

router = APIRouter(prefix="/example-garden", tags=["example-garden"])

# data/ is a sibling of backend/ at the repo root - same relative-path
# pattern app/scripts/import_plants.py already uses to reach data/plants/.
_EXAMPLE_GARDEN_PATH = Path(__file__).resolve().parents[4] / "data" / "example_garden.json"


class ExamplePlanting(BaseModel):
    plant_slug: str
    x_cm: float
    y_cm: float


class ExampleBed(BaseModel):
    """Mirrors the real Bed API shape (app/api/routes/beds.py) - kept as its
    own schema rather than reused directly since this fixture also carries
    `plantings`, which isn't a Bed field. NOTE: data/example_garden.json
    itself still needs regenerating (data-engineer's job, see
    data/etl/generate_example_garden.py) to match this shape - until then
    this endpoint will fail validation against the old bed_type/flat-field
    fixture on disk, a known, temporary gap while that regeneration is
    pending."""

    name: str
    category: str | None = None
    border_geometry: Geometry
    height_cm: float = 0
    has_greenhouse: bool = False
    orientation: str | None = None
    soil_type: str | None = None
    sun_level: SunLevel | None = None
    notes: str = ""
    plantings: list[ExamplePlanting] = []


class ExampleGarden(BaseModel):
    beds: list[ExampleBed]


class SeedResultResponse(BaseModel):
    beds_imported: int
    beds_failed: int
    failures: list[str]


@router.get("", response_model=ExampleGarden)
def get_example_garden() -> ExampleGarden:
    """Serves data/example_garden.json as-is - a dev/demo fixture (see
    data/etl/generate_example_garden.py), not backed by any table. Read-only:
    there's no POST/PATCH/DELETE here, and nothing here writes to Postgres -
    this just lets the frontend preview the fixture without a copy of the
    file living in frontend/ that could drift out of sync."""
    if not _EXAMPLE_GARDEN_PATH.exists():
        raise HTTPException(status_code=404, detail="No example garden data generated yet")
    data = json.loads(_EXAMPLE_GARDEN_PATH.read_text(encoding="utf-8"))
    return ExampleGarden(**data)


@router.post("/seed", response_model=SeedResultResponse)
def seed_example_garden_route(session: Session = Depends(get_session)) -> SeedResultResponse:
    """Runs the same idempotent import as
    `uv run python -m app.scripts.import_example_garden`, but against the
    live DB session - lets a running frontend seed the real database over
    HTTP instead of needing someone to SSH in and run the script by hand.
    Get-or-create by bed name, same as the script (see that module's own
    docstring for the full idempotency contract)."""
    if not _EXAMPLE_GARDEN_PATH.exists():
        raise HTTPException(status_code=404, detail="No example garden data generated yet")
    result = seed_example_garden(session, path=_EXAMPLE_GARDEN_PATH)
    return SeedResultResponse(
        beds_imported=result.beds_imported,
        beds_failed=result.beds_failed,
        failures=result.failures,
    )
