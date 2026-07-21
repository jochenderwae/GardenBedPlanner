"""Companion-planting and shade-casting checks for a candidate plant
placement (see root CLAUDE.md's domain note: "Companion planting and
shade-casting checks depend on bed position/orientation and neighboring
plant height... factor sun direction into the layout editor eventually,
not just adjacency" - issue #27).

Reuses PlantCompanion (app/models/plant.py) for companion/antagonist pairs
- no new model needed. Shade-casting has no dedicated table at all: it's
derived purely from geometry (Bed.border_geometry + Garden.orientation_deg)
and Plant.height_cm at query time, the same way check_rotation
(app/services/rotation.py) derives its warning from existing Planting
history rather than a separate "rotation risk" table.

Geometry convention (pinned down on #27, spread across frontend files
backend/ work wouldn't normally look at - see that issue's own research
note for the full derivation, kept here only as a summary):
- All rotation is degrees, clockwise, in a y-down canvas frame.
- Garden.orientation_deg is degrees clockwise from canvas-up to true
  north (frontend/src/pages/layout/CompassWidget.tsx).
- Planting.geometry is bed-local (origin at the bed's own unrotated
  bounding-box top-left, per docs/schema.md's "Coordinate spaces"); its
  garden-space position is that local point rotated by
  Bed.border_geometry.rotation then translated by
  (Bed.border_geometry.x, Bed.border_geometry.y) - standard 2D rotation,
  matching Konva's own rotate-then-translate semantics for a Group.
"""

import math
from datetime import date

from pydantic import BaseModel
from sqlmodel import Session, select

from app.models.bed import Bed
from app.models.garden import Garden
from app.models.geometry import PolygonGeometry, RectangleGeometry, parse_geometry
from app.models.plant import CompanionRelationship, Plant, PlantCompanion
from app.models.planting import Planting

# How close two plantings' world-space centers have to be (in cm) to count
# as "neighbors" for companion/shade purposes - covers plantings in
# adjoining beds, not just the same bed. No agronomic reference dictates
# this exact figure (same caveat as rotation.py's DEFAULT_LOOKBACK_DAYS) -
# a generous default meant to catch adjacent-bed placements, tunable via
# the placement-check endpoint's own param.
DEFAULT_NEIGHBOR_DISTANCE_CM = 150.0

# How far off due south (bearing 180, the sun's broad direction in
# Belgium/the northern hemisphere) a neighbor can be and still count as a
# shade-casting risk, rather than requiring an exact due-south bearing.
SHADE_BEARING_TOLERANCE_DEG = 60.0


class CompanionMatch(BaseModel):
    neighbor_planting_id: int
    neighbor_plant_slug: str
    neighbor_plant_common_name: str
    relationship: CompanionRelationship
    mechanism: str | None = None
    notes: str | None = None
    distance_cm: float


class ShadeWarning(BaseModel):
    neighbor_planting_id: int
    neighbor_plant_slug: str
    neighbor_plant_common_name: str
    neighbor_height_cm: float
    bearing_deg: float
    distance_cm: float
    # "shaded_by_neighbor": the neighbor is taller and roughly due south of
    # the candidate, so the candidate risks being shaded by it.
    # "shades_neighbor": the candidate is taller and roughly due south of
    # the neighbor, so placing it here risks shading that existing
    # neighbor instead. Checked in both directions since either is a real
    # "shade-casting risk", just from a different plant's perspective.
    direction: str


class PlacementCheck(BaseModel):
    companions: list[CompanionMatch] = []
    antagonists: list[CompanionMatch] = []
    shade_warnings: list[ShadeWarning] = []


def _local_center(geometry: dict) -> tuple[float, float]:
    parsed = parse_geometry(geometry)
    if isinstance(parsed, RectangleGeometry):
        return (parsed.x + parsed.width / 2, parsed.y + parsed.height / 2)
    xs = [p.x for p in parsed.points]
    ys = [p.y for p in parsed.points]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _bed_local_to_world(bed: Bed, local: tuple[float, float]) -> tuple[float, float]:
    """A bed-local point's position in garden space. Rectangle-shaped beds
    rotate the point around the bed's own (x, y) origin by
    border_geometry.rotation, then translate by (x, y) - the same
    rotate-then-translate transform Konva applies to a Group's children.
    Polygon-shaped beds have no separate rotation field (their vertices
    already encode it - geometry.py's own note: "rotation only applies to
    rectangle") - bed-local points on those are translated by the
    polygon's own unrotated bounding-box top-left, with no rotation."""
    bed_geometry = parse_geometry(bed.border_geometry)
    local_x, local_y = local
    if isinstance(bed_geometry, PolygonGeometry):
        origin_x = min(p.x for p in bed_geometry.points)
        origin_y = min(p.y for p in bed_geometry.points)
        return (origin_x + local_x, origin_y + local_y)
    r = math.radians(bed_geometry.rotation)
    world_x = bed_geometry.x + local_x * math.cos(r) - local_y * math.sin(r)
    world_y = bed_geometry.y + local_x * math.sin(r) + local_y * math.cos(r)
    return (world_x, world_y)


def _bearing_deg(origin: tuple[float, float], target: tuple[float, float], garden_orientation_deg: float) -> float:
    """Compass bearing from `origin` to `target`, relative to true north
    (garden_orientation_deg) - same canvas-angle convention as
    frontend/src/pages/layout/CompassWidget.tsx's angleFromCenter."""
    dx = target[0] - origin[0]
    dy = target[1] - origin[1]
    if dx == 0 and dy == 0:
        return 0.0
    canvas_angle_deg = math.degrees(math.atan2(dx, -dy))
    return (canvas_angle_deg - garden_orientation_deg) % 360


def _bearing_diff(bearing_deg: float, target_deg: float) -> float:
    """Smallest absolute angular difference between two bearings (0-180)."""
    diff = abs(bearing_deg - target_deg) % 360
    return min(diff, 360 - diff)


def _casts_shade(
    caster_height_cm: float | None,
    target_height_cm: float | None,
    bearing_from_target_to_caster: float,
) -> bool:
    """True if a plant of `caster_height_cm`, positioned at the given
    bearing *from* the target plant's position, would shade a shorter
    target plant - i.e. it's taller and roughly due south of the target."""
    if caster_height_cm is None or target_height_cm is None:
        return False
    if caster_height_cm <= target_height_cm:
        return False
    return _bearing_diff(bearing_from_target_to_caster, 180.0) <= SHADE_BEARING_TOLERANCE_DEG


def check_placement(
    session: Session,
    bed: Bed,
    candidate_plant: Plant,
    candidate_geometry: dict,
    garden: Garden,
    neighbor_distance_cm: float = DEFAULT_NEIGHBOR_DISTANCE_CM,
    as_of: date | None = None,
    exclude_planting_id: int | None = None,
) -> PlacementCheck:
    """Checks a candidate plant placement (not necessarily saved yet - the
    caller supplies bed_id/plant/geometry directly rather than a Planting
    id) against every other active Planting in the garden for:
    - companion/antagonist relationships (PlantCompanion), and
    - shade-casting risk in either direction (an existing taller neighbor
      shading the candidate, or the candidate - if taller - shading a
      shorter existing neighbor).

    "Neighbor" is distance-based in garden-space world coordinates, not
    same-bed-only - two plantings in adjoining beds are still neighbors,
    and a bed boundary has no botanical significance.
    """
    if as_of is None:
        as_of = date.today()

    candidate_world = _bed_local_to_world(bed, _local_center(candidate_geometry))

    rows = list(
        session.exec(
            select(Planting, Plant, Bed)
            .join(Plant, Plant.slug == Planting.plant_slug)
            .join(Bed, Bed.id == Planting.bed_id)
        ).all()
    )

    companions: list[CompanionMatch] = []
    antagonists: list[CompanionMatch] = []
    shade_warnings: list[ShadeWarning] = []

    for planting, plant, planting_bed in rows:
        if planting.id == exclude_planting_id:
            continue
        if planting.removed_date is not None and planting.removed_date <= as_of:
            continue

        neighbor_world = _bed_local_to_world(planting_bed, _local_center(planting.geometry))
        distance_cm = math.hypot(neighbor_world[0] - candidate_world[0], neighbor_world[1] - candidate_world[1])
        if distance_cm > neighbor_distance_cm:
            continue

        # Companion/antagonist relationships - PlantCompanion rows are
        # stored from one plant's own perspective only (see
        # app/scripts/import_plants.py's own note on this), so check both
        # directions rather than assuming symmetric storage.
        relationship_row = session.exec(
            select(PlantCompanion).where(
                (
                    (PlantCompanion.plant_slug == candidate_plant.slug)
                    & (PlantCompanion.companion_plant_slug == plant.slug)
                )
                | (
                    (PlantCompanion.plant_slug == plant.slug)
                    & (PlantCompanion.companion_plant_slug == candidate_plant.slug)
                )
            )
        ).first()
        if relationship_row is not None:
            match = CompanionMatch(
                neighbor_planting_id=planting.id,  # type: ignore[arg-type]
                neighbor_plant_slug=plant.slug,
                neighbor_plant_common_name=plant.common_name,
                relationship=relationship_row.relationship,
                mechanism=relationship_row.mechanism,
                notes=relationship_row.notes,
                distance_cm=distance_cm,
            )
            if relationship_row.relationship == CompanionRelationship.good:
                companions.append(match)
            else:
                antagonists.append(match)

        # Shade-casting, checked in both directions (see ShadeWarning's
        # own docstring for why).
        bearing_candidate_to_neighbor = _bearing_deg(candidate_world, neighbor_world, garden.orientation_deg)
        if _casts_shade(plant.height_cm, candidate_plant.height_cm, bearing_candidate_to_neighbor):
            shade_warnings.append(
                ShadeWarning(
                    neighbor_planting_id=planting.id,  # type: ignore[arg-type]
                    neighbor_plant_slug=plant.slug,
                    neighbor_plant_common_name=plant.common_name,
                    neighbor_height_cm=plant.height_cm,  # type: ignore[arg-type]
                    bearing_deg=bearing_candidate_to_neighbor,
                    distance_cm=distance_cm,
                    direction="shaded_by_neighbor",
                )
            )
        bearing_neighbor_to_candidate = _bearing_deg(neighbor_world, candidate_world, garden.orientation_deg)
        if _casts_shade(candidate_plant.height_cm, plant.height_cm, bearing_neighbor_to_candidate):
            shade_warnings.append(
                ShadeWarning(
                    neighbor_planting_id=planting.id,  # type: ignore[arg-type]
                    neighbor_plant_slug=plant.slug,
                    neighbor_plant_common_name=plant.common_name,
                    neighbor_height_cm=plant.height_cm,  # type: ignore[arg-type]
                    bearing_deg=bearing_neighbor_to_candidate,
                    distance_cm=distance_cm,
                    direction="shades_neighbor",
                )
            )

    return PlacementCheck(companions=companions, antagonists=antagonists, shade_warnings=shade_warnings)
