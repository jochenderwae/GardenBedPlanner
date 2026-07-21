from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    actions,
    bed_equipment,
    beds,
    example_garden,
    garden,
    garden_plans,
    harvest_logs,
    health,
    period_types,
    placement,
    plantings,
    plants,
    push_subscriptions,
    rotation,
    seed_inventory_items,
)
from app.core.config import settings
from app.core.scheduler import register_jobs, scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    register_jobs()
    scheduler.start()
    yield
    scheduler.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(title="GardenBedPlanner API", lifespan=lifespan)

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
    app.include_router(plantings.router, prefix="/api")
    app.include_router(bed_equipment.router, prefix="/api")
    app.include_router(rotation.router, prefix="/api")
    app.include_router(placement.router, prefix="/api")
    app.include_router(garden_plans.router, prefix="/api")
    app.include_router(actions.router, prefix="/api")
    app.include_router(harvest_logs.router, prefix="/api")
    app.include_router(push_subscriptions.router, prefix="/api")
    app.include_router(seed_inventory_items.router, prefix="/api")

    return app


app = create_app()
