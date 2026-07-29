"""Nozzle sizing / runtime calculation for drip irrigation (#140) - given a
bed's plantings' water need and its footprint area, size how long a bed's
nozzles/emitters need to run per week (or, given a desired runtime, what
nozzle rating is needed) to meet that need.

Governing figure for a bed with multiple plantings sharing it (2026-07-28
user decision, recorded on #140's own issue comments): the *thirstiest*
active planting's water_needs_mm_per_week, not an average or per-planting
sub-areas - size for the plant with the highest requirement.

Multi-nozzle aggregation stays a deliberately deferred simplification per
#140's own "flag this as a known simplification for a first pass" note:
this sums every BedEquipment row on the bed with a water_delivery_lph set,
treating the whole bed as one coverage area rather than modeling per-nozzle
coverage sub-areas/overlap - real equipment-placement granularity to
support that precisely doesn't exist yet.
"""

from pydantic import BaseModel
from sqlmodel import Session, select

from app.models.bed import Bed
from app.models.bed_equipment import BedEquipment
from app.models.geometry import PolygonGeometry, RectangleGeometry, parse_geometry
from app.models.plant import Plant
from app.models.planting import Planting


def _geometry_area_cm2(geometry: dict) -> float:
    """Rectangle: width x height. Polygon: shoelace formula. Matches
    docs/schema.md's Geometry format (rectangle|polygon) - no existing area
    helper elsewhere in this codebase (checked) to reuse instead."""
    parsed = parse_geometry(geometry)
    if isinstance(parsed, RectangleGeometry):
        return parsed.width * parsed.height
    assert isinstance(parsed, PolygonGeometry)
    points = parsed.points
    total = 0.0
    for i in range(len(points)):
        p1 = points[i]
        p2 = points[(i + 1) % len(points)]
        total += p1.x * p2.y - p2.x * p1.y
    return abs(total) / 2


def bed_area_m2(bed: Bed) -> float:
    # cm^2 -> m^2. 1mm of water depth over 1m^2 = 1 liter, which is the unit
    # relationship target_volume_l_per_week below relies on.
    return _geometry_area_cm2(bed.border_geometry) / 10_000


class GoverningPlanting(BaseModel):
    planting_id: int
    plant_slug: str
    plant_common_name: str
    water_needs_mm_per_week: float


class IrrigationSizing(BaseModel):
    bed_id: int
    bed_area_m2: float
    # None if the bed has no active planting with a known water need - there's
    # nothing to size against yet.
    governing_planting: GoverningPlanting | None = None
    target_volume_l_per_week: float | None = None
    # Sum of water_delivery_lph across the bed's own BedEquipment rows that
    # have one set - None if none do.
    total_water_delivery_lph: float | None = None
    # target_volume_l_per_week / total_water_delivery_lph - None unless both
    # of those are known.
    required_runtime_hours_per_week: float | None = None
    # Only populated when the caller supplies desired_runtime_hours_per_week:
    # target_volume_l_per_week / that runtime - the inverse calculation.
    required_lph_for_desired_runtime: float | None = None


def compute_irrigation_sizing(
    session: Session,
    bed: Bed,
    desired_runtime_hours_per_week: float | None = None,
) -> IrrigationSizing:
    area_m2 = bed_area_m2(bed)

    rows = list(
        session.exec(
            select(Planting, Plant)
            .join(Plant, Plant.slug == Planting.plant_slug)
            .where(Planting.bed_id == bed.id)
            .where(Planting.removed_date.is_(None))
            .where(Plant.water_needs_mm_per_week.is_not(None))
        ).all()
    )

    governing: GoverningPlanting | None = None
    target_volume: float | None = None
    if rows:
        planting, plant = max(rows, key=lambda pair: pair[1].water_needs_mm_per_week)  # type: ignore[arg-type,return-value]
        governing = GoverningPlanting(
            planting_id=planting.id,  # type: ignore[arg-type]
            plant_slug=plant.slug,
            plant_common_name=plant.common_name,
            water_needs_mm_per_week=plant.water_needs_mm_per_week,  # type: ignore[arg-type]
        )
        target_volume = plant.water_needs_mm_per_week * area_m2  # type: ignore[operator]

    equipment_rows = list(
        session.exec(
            select(BedEquipment)
            .where(BedEquipment.bed_id == bed.id)
            .where(BedEquipment.water_delivery_lph.is_not(None))
        ).all()
    )
    total_lph = sum(e.water_delivery_lph for e in equipment_rows) if equipment_rows else None  # type: ignore[misc]

    required_runtime = None
    if target_volume is not None and total_lph:
        required_runtime = target_volume / total_lph

    required_lph = None
    if target_volume is not None and desired_runtime_hours_per_week:
        required_lph = target_volume / desired_runtime_hours_per_week

    return IrrigationSizing(
        bed_id=bed.id,  # type: ignore[arg-type]
        bed_area_m2=area_m2,
        governing_planting=governing,
        target_volume_l_per_week=target_volume,
        total_water_delivery_lph=total_lph,
        required_runtime_hours_per_week=required_runtime,
        required_lph_for_desired_runtime=required_lph,
    )
