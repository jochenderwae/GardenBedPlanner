from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    actions,
    bed_equipment,
    beds,
    compost_bins,
    compost_fertilization_logs,
    decorations,
    equipment_types,
    example_garden,
    garden,
    garden_plans,
    harvest_logs,
    health,
    irrigation_connections,
    irrigation_parts,
    irrigation_sizing,
    irrigation_zones,
    period_types,
    placement,
    plantings,
    plants,
    push_subscriptions,
    rotation,
    seed_inventory_items,
    soil_rotation_events,
)
from app.core.config import Settings, settings
from app.core.scheduler import register_jobs, scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    register_jobs()
    scheduler.start()
    yield
    scheduler.shutdown()


def create_app(app_settings: Settings | None = None) -> FastAPI:
    app_settings = app_settings or settings
    # Interactive docs are only ever meant to be reachable on the LAN today
    # (no auth in front of the backend's own directly-bound port). Disable
    # them outright when ENVIRONMENT=production, as defense in depth for
    # internet-facing deployments - see #176.
    is_production = app_settings.environment == "production"
    app = FastAPI(
        title="GardenBedPlanner API",
        lifespan=lifespan,
        docs_url=None if is_production else "/docs",
        redoc_url=None if is_production else "/redoc",
        openapi_url=None if is_production else "/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(beds.router, prefix="/api")
    app.include_router(plants.router, prefix="/api")
    app.include_router(period_types.router, prefix="/api")
    app.include_router(example_garden.router, prefix="/api")
    app.include_router(garden.router, prefix="/api")
    app.include_router(garden.gardens_router, prefix="/api")
    app.include_router(plantings.router, prefix="/api")
    app.include_router(bed_equipment.router, prefix="/api")
    app.include_router(rotation.router, prefix="/api")
    app.include_router(placement.router, prefix="/api")
    app.include_router(garden_plans.router, prefix="/api")
    app.include_router(actions.router, prefix="/api")
    app.include_router(harvest_logs.router, prefix="/api")
    app.include_router(push_subscriptions.router, prefix="/api")
    app.include_router(seed_inventory_items.router, prefix="/api")
    app.include_router(irrigation_zones.router, prefix="/api")
    app.include_router(irrigation_parts.router, prefix="/api")
    app.include_router(irrigation_connections.router, prefix="/api")
    app.include_router(irrigation_sizing.router, prefix="/api")
    app.include_router(compost_fertilization_logs.router, prefix="/api")
    app.include_router(compost_bins.router, prefix="/api")
    app.include_router(equipment_types.router, prefix="/api")
    app.include_router(decorations.router, prefix="/api")
    app.include_router(soil_rotation_events.router, prefix="/api")

    return app


app = create_app()
