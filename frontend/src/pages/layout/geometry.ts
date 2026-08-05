import type { Geometry, PlacementType, Plant, PolygonGeometry, RectangleGeometry } from "@/api/client";

/** 1cm = 1px - real bed sizes (30-200cm) map directly to a readable canvas
 * scale without needing zoom/pan for a first pass. Revisit if/when gardens
 * with a much larger total footprint make this too small or the canvas too
 * large to be usable. */
export const CM_TO_PX = 1;

export const CANVAS_WIDTH_PX = 1400;
export const CANVAS_HEIGHT_PX = 900;
export const GRID_SPACING_CM = 50;
export const DRAG_SNAP_CM = 10;
/** Arrow-key nudge step (cm) for the currently-selected bed/planting - a
 * plain arrow press moves this far; a shift+arrow press moves the coarser
 * `DRAG_SNAP_CM` instead, matching the fine/coarse convention most design
 * tools (Figma etc.) use for arrow-key nudging. */
export const NUDGE_STEP_CM = 1;

export function snapToGrid(value: number, gridSizeCm: number = DRAG_SNAP_CM): number {
  return Math.round(value / gridSizeCm) * gridSizeCm;
}

/** Normalizes an angle in degrees to the [0, 360) range. */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** A bed's `border_geometry.rotation` is stored (and rendered by Konva) as
 * an absolute canvas-space angle, unrelated to which way the garden itself
 * faces. These two pure conversions let the UI show/edit that angle
 * *relative* to `Garden.orientation_deg` (0 = "aligned with the garden's own
 * orientation") without changing what's actually stored/rendered - the
 * garden-relative value is purely a display/input transform on top of the
 * same absolute rotation. */
export function rotationRelativeToGarden(absoluteDeg: number, gardenOrientationDeg: number): number {
  return normalizeDegrees(absoluteDeg - gardenOrientationDeg);
}

export function rotationFromGardenRelative(relativeDeg: number, gardenOrientationDeg: number): number {
  return normalizeDegrees(relativeDeg + gardenOrientationDeg);
}

/** Default footprint (cm) for a plant placement when the plant has no
 * spread_cm/row_spacing_cm on file - keeps a planting visible instead of
 * collapsing to a near-invisible dot. */
export const DEFAULT_PLANTING_DIAMETER_CM = 20;

/** A plant's own recommended default row/area marker spacing (cm), before
 * any explicit per-placement override - prefers `plant_spacing_cm` (a
 * genuine recommended in-row planting distance) over `spread_cm` (the
 * plant's mature visual footprint, a *different* thing a plant can
 * legitimately be planted closer together than - #195), `null` when
 * neither is set on the plant record at all. */
export function defaultPlantSpacing(plant: Plant | undefined): number | null {
  return plant?.plant_spacing_cm ?? plant?.spread_cm ?? null;
}

/** The effective marker spacing (cm) actually used to render/place a row
 * or area planting - an explicit per-placement override (#154's own
 * `spacing_cm`) always wins over `defaultPlantSpacing`, falling back to
 * `DEFAULT_PLANTING_DIAMETER_CM` when neither the override nor either of
 * the plant's own fields is set. Centralizes the fallback chain every
 * row/area rendering site (`PlantPlacementLayer`, `GardenSnapshotView`,
 * `TechnicalDrawingLayer`) and `PlantingPanel`'s own spacing-field default
 * copy need identically, so a future change to the priority order is a
 * one-function edit, not a find-replace across several files. */
export function effectivePlantSpacing(explicitSpacingCm: number | null | undefined, plant: Plant | undefined): number {
  return explicitSpacingCm ?? defaultPlantSpacing(plant) ?? DEFAULT_PLANTING_DIAMETER_CM;
}

/** Row-axis counterpart of `defaultPlantSpacing` (#264) - a plant's own
 * recommended default *between-row* spacing for an area (`field`)
 * placement's grid, distinct from `defaultPlantSpacing`'s *within-row*
 * spacing. Prefers `Plant.row_spacing_cm` (a genuine between-row
 * recommendation) over `spread_cm` (the plant's mature footprint, same
 * fallback-of-last-resort `defaultPlantSpacing` already uses for its own
 * axis), `null` when neither is set. */
export function defaultPlantRowSpacing(plant: Plant | undefined): number | null {
  return plant?.row_spacing_cm ?? plant?.spread_cm ?? null;
}

/** Row-axis counterpart of `effectivePlantSpacing` - an explicit
 * per-placement override (`Planting.row_spacing_cm`, #264/#265) always wins
 * over `defaultPlantRowSpacing`, falling back to
 * `DEFAULT_PLANTING_DIAMETER_CM` when neither is set. Only meaningful for a
 * `field` placement's y-axis; a `row` placement has no "between rows" axis
 * at all. */
export function effectiveRowSpacing(explicitRowSpacingCm: number | null | undefined, plant: Plant | undefined): number {
  return explicitRowSpacingCm ?? defaultPlantRowSpacing(plant) ?? DEFAULT_PLANTING_DIAMETER_CM;
}

/** Deterministic string -> hue, so the same key (a plant slug, a bed
 * category, ...) always gets the same color across renders without
 * maintaining a lookup table by hand. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Deterministic slug -> HSL color for a plant placement dot. */
export function colorForSlug(slug: string): string {
  return `hsl(${hashString(slug)}, 55%, 55%)`;
}

const DEFAULT_BED_COLORS = { fill: "#d7e4d5", stroke: "#5b8c5a" };

/** Bed fill/stroke used to be looked up from a fixed bed_type -> color
 * table; bed_type is gone now (see backend/app/models/bed.py's comment -
 * it was never meant as a closed category list), so this derives a stable
 * color from whatever free-text `category` the user gave the bed instead,
 * falling back to a neutral default when there isn't one. */
export function colorsForBedCategory(category: string | null | undefined): { fill: string; stroke: string } {
  if (!category) return DEFAULT_BED_COLORS;
  const hue = hashString(category);
  return { fill: `hsl(${hue}, 45%, 88%)`, stroke: `hsl(${hue}, 45%, 45%)` };
}

/** Minimum drag distance (cm) before a row/area drag commits a planting -
 * below this it's treated as an accidental tiny drag (or a click that
 * barely moved) rather than a deliberate row/area, mirroring `MIN_SIZE_CM`
 * style minimums used elsewhere for beds/the garden boundary. */
export const MIN_ROW_LENGTH_CM = 20;
export const MIN_FIELD_SIZE_CM = 20;

/** A `row` planting's geometry: a thin rectangle running from `start` to
 * `end`, `thicknessCm` wide (typically the plant's own `spread_cm`),
 * centered on the drag line. Rotation pivots on the rectangle's own x/y
 * corner (same Konva `Rect` semantics `BedNode`/`GardenBoundary` already
 * rely on), so `x`/`y` is `start` itself and the unrotated rectangle runs
 * along local +x before rotating to match the drag's actual angle. Returns
 * `null` for a drag shorter than `MIN_ROW_LENGTH_CM` (not a deliberate row). */
export function rowGeometryFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thicknessCm: number,
): RectangleGeometry | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_ROW_LENGTH_CM) return null;
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { type: "rectangle", x: start.x, y: start.y - thicknessCm / 2, width: length, height: thicknessCm, rotation };
}

/** How many degrees apart each angle-snap increment is when a row drag is
 * angle-constrained (see `snapPointToAngle`) - 8-way (0/45/90/.../315deg),
 * the standard CAD-style horizontal/vertical/diagonal constraint used while
 * Ctrl is held during a row-placement drag (#262). */
export const ANGLE_SNAP_STEP_DEG = 45;

/** Projects `end` onto the nearest `stepDeg`-multiple ray from `start` (an
 * 8-way 0/45/90/.../315deg constraint at the default `ANGLE_SNAP_STEP_DEG`) -
 * used while a row placement drag is angle-constrained (Ctrl held, #262).
 * Snaps the drag's *direction* to the nearest allowed angle, then keeps the
 * endpoint at the raw drag's own projected length along that direction
 * (`dx`/`dy` dotted with the snapped unit vector) rather than its full
 * straight-line length - so the constrained endpoint tracks as closely as
 * the angle constraint allows to where the cursor actually is, instead of
 * snapping the angle but leaving the endpoint somewhere the cursor never
 * was. */
export function snapPointToAngle(
  start: { x: number; y: number },
  end: { x: number; y: number },
  stepDeg: number = ANGLE_SNAP_STEP_DEG,
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return { ...end };
  const rawAngleRad = Math.atan2(dy, dx);
  const stepRad = (stepDeg * Math.PI) / 180;
  const snappedAngleRad = Math.round(rawAngleRad / stepRad) * stepRad;
  const dirX = Math.cos(snappedAngleRad);
  const dirY = Math.sin(snappedAngleRad);
  const projectedLength = dx * dirX + dy * dirY;
  return { x: start.x + projectedLength * dirX, y: start.y + projectedLength * dirY };
}

/** A `field` planting's geometry: the axis-aligned rectangle spanning
 * `start` and `end` (whichever corner order the drag happened in) - unlike
 * a row, the drawn extent itself *is* the planted area, not derived from
 * plant spacing. Returns `null` for a drag smaller than
 * `MIN_FIELD_SIZE_CM` on either axis. */
export function fieldGeometryFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): RectangleGeometry | null {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < MIN_FIELD_SIZE_CM || height < MIN_FIELD_SIZE_CM) return null;
  return { type: "rectangle", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, rotation: 0 };
}

/** Plain x/y/width/height/rotation, deliberately not `RectangleGeometry`
 * itself (no `type: "rectangle"` discriminant required) - matches what
 * `rectRenderProps` already returns, so `rowMarkerPositions`/
 * `fieldMarkerPositions` below can be called directly with its output at
 * their call site without reconstructing a full `RectangleGeometry`. */
type RectShape = { x: number; y: number; width: number; height: number; rotation: number };

/** Converts a point in a rectangle's own local (unrotated, origin at the
 * rectangle's x/y corner) coordinate space to the same world/bed-local
 * space `geometry.x`/`geometry.y` itself lives in - shared by
 * `rowMarkerPositions`/`fieldMarkerPositions` below so each only has to
 * reason about laying points out along an unrotated width/height, not
 * rotation math too. */
function localPointToGeometrySpace(geometry: RectShape, local: { x: number; y: number }): { x: number; y: number } {
  const rad = (geometry.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: geometry.x + local.x * cos - local.y * sin,
    y: geometry.y + local.x * sin + local.y * cos,
  };
}

/** Evenly spaces `count` points across `[0, length]`, each centered in its
 * own `length / count` segment - e.g. `count=3` on a length-90 span
 * returns 15/45/75, not 0/45/90 (no point sitting exactly on the row's own
 * edge) or a fixed-step layout that leaves uneven leftover space at one
 * end. Shared by both axes of `fieldMarkerPositions` and the single axis
 * `rowMarkerPositions` fills. */
export function centeredSegments(length: number, count: number): number[] {
  const step = length / count;
  return Array.from({ length: count }, (_, i) => step * (i + 0.5));
}

/** How many spacing-sized segments fit across `length` - always at least 1,
 * so even a placement narrower than one spacing interval still renders its
 * single center point rather than nothing. */
export function segmentCount(length: number, spacingCm: number): number {
  return Math.max(1, Math.round(length / Math.max(1, spacingCm)));
}

/** Individual plant marker positions (world/bed-local cm, matching
 * `planting.geometry`'s own coordinate space) for a `row` placement's
 * bounding rectangle at `spacingCm` intervals - the drawn rectangle itself
 * is just the placement's own drag/select/delete hit-target (see
 * PlantPlacementLayer.tsx's `PlantingMarker`), this is what actually paints
 * as individual plants inside it. One line of points along the rectangle's
 * own local +x axis (its length/`width`), centered on the thickness
 * (`height / 2`) and accounting for the rectangle's own `rotation` (a
 * row's drawn angle) via `localPointToGeometrySpace`. */
export function rowMarkerPositions(geometry: RectShape, spacingCm: number): { x: number; y: number }[] {
  const count = segmentCount(geometry.width, spacingCm);
  return centeredSegments(geometry.width, count).map((x) =>
    localPointToGeometrySpace(geometry, { x, y: geometry.height / 2 }),
  );
}

/** Same idea as `rowMarkerPositions`, for a `field` placement - a grid
 * filling both axes rather than a single line. `field` geometry is always
 * axis-aligned (`fieldGeometryFromDrag` never sets a rotation), but this
 * still routes through `localPointToGeometrySpace` for consistency (a
 * no-op at `rotation: 0`). `rowSpacingCm` (#264) is the y-axis/between-row
 * spacing, independent of `spacingCm`'s x-axis/within-row spacing - defaults
 * to `spacingCm` (a uniform square grid, the only behavior that existed
 * before #264) when omitted, so existing 2-arg callers are unaffected. */
export function fieldMarkerPositions(geometry: RectShape, spacingCm: number, rowSpacingCm: number = spacingCm): { x: number; y: number }[] {
  const xs = centeredSegments(geometry.width, segmentCount(geometry.width, spacingCm));
  const ys = centeredSegments(geometry.height, segmentCount(geometry.height, rowSpacingCm));
  const points: { x: number; y: number }[] = [];
  for (const y of ys) {
    for (const x of xs) {
      points.push(localPointToGeometrySpace(geometry, { x, y }));
    }
  }
  return points;
}

/** Every point a planting's own marker(s) render at - a single center point
 * for an `individual` placement, or the same `rowMarkerPositions`/
 * `fieldMarkerPositions` grid `PlantingMarker`/`SnapshotPlantingMarker`
 * already draw markers at for a `row`/`field` one. Factored out so the
 * spread-size outline (#173's `SpreadOutline`, drawn as its own render pass
 * so it can never sit visually on top of another planting's solid marker -
 * see that ticket's design spec) can be positioned identically to the real
 * markers without duplicating this placement-type branch a third time. */
export function plantingMarkerPositions(
  placementType: PlacementType,
  geometry: Geometry,
  spacingCm: number | null | undefined,
  plant: Plant | undefined,
  rowSpacingCm?: number | null,
): { x: number; y: number }[] {
  if (placementType === "row" || placementType === "field") {
    const props = rectRenderProps(geometry);
    const effectiveSpacing = effectivePlantSpacing(spacingCm, plant);
    if (placementType === "row") return rowMarkerPositions(props, effectiveSpacing);
    return fieldMarkerPositions(props, effectiveSpacing, effectiveRowSpacing(rowSpacingCm, plant));
  }
  const rect = boundingRect(geometry);
  return [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }];
}

/** Flattens either geometry variant to renderable `Rect` props (x/y/width/
 * height/rotation) - rectangles pass through as-is, polygons fall back to
 * their unrotated bounding box (same simplification `boundingRect` already
 * makes). Used for `row`/`field` planting markers, which need the actual
 * rotated rectangle (not just its bounding box) to render as the shape
 * that was actually drawn. */
export function rectRenderProps(geometry: Geometry): { x: number; y: number; width: number; height: number; rotation: number } {
  if (geometry.type === "rectangle") return geometry;
  return { ...boundingRect(geometry), rotation: 0 };
}

/** Axis-aligned bounding box for either geometry variant, in garden-space
 * (or bed-local, if that's the space the geometry itself is already in) -
 * used wherever a shape needs a flat x/y/width/height regardless of
 * whether it's actually a rectangle or a polygon (e.g. read-only previews
 * that don't need full polygon rendering, just "roughly where is this"). */
export function boundingRect(geometry: Geometry): { x: number; y: number; width: number; height: number } {
  if (geometry.type === "rectangle") {
    return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  }
  const xs = geometry.points.map((p) => p.x);
  const ys = geometry.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Rectangle -> its 4 corners as a polygon, in clockwise order starting
 * top-left - used when the user switches the shape-type selector from
 * Rectangle to Polygon so the shape's rough extent carries over instead of
 * resetting to nothing. Rotation isn't preserved as a `rotation` field
 * (polygons don't have one) but IS baked into the corner positions. */
export function rectangleToPolygon(rect: RectangleGeometry): PolygonGeometry {
  const rad = (rect.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: 0, y: 0 },
    { x: rect.width, y: 0 },
    { x: rect.width, y: rect.height },
    { x: 0, y: rect.height },
  ];
  return {
    type: "polygon",
    points: corners.map((c) => ({
      x: rect.x + c.x * cos - c.y * sin,
      y: rect.y + c.x * sin + c.y * cos,
    })),
  };
}

/** Polygon -> its axis-aligned bounding box as a rectangle (rotation 0) -
 * used when switching the shape-type selector from Polygon to Rectangle.
 * Lossy for a non-axis-aligned polygon (corners outside the box are
 * discarded), same tradeoff the backend's own downgrade migration accepts
 * for the same conversion. */
export function polygonToRectangle(polygon: PolygonGeometry): RectangleGeometry {
  const rect = boundingRect(polygon);
  return { type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0 };
}

/** Metric-only for now (see root CLAUDE.md: "make sure imperial can be
 * added later") - callers should route all on-canvas distance labels
 * through this instead of formatting cm directly, so plugging in an
 * imperial variant later is a one-function change, not a find-replace. */
export function formatDistanceCm(cm: number): string {
  return `${(cm / 100).toFixed(cm % 100 === 0 ? 0 : 1)}m`;
}

/** A planting's own center point (bed-local cm) - what `data/etl/
 * verify_garden.py`'s out-of-bounds check (and `plantingsOutsideBounds`
 * below) test against a bed's footprint, not the full marker rectangle's
 * own edges: a plant sown right at a bed's edge is legitimate, only its
 * center actually needs to fall within the bed (see that script's own doc
 * on why - marker-rectangle overflow near an edge isn't a real data
 * problem). */
export function plantingCenter(geometry: Geometry): { x: number; y: number } {
  const rect = boundingRect(geometry);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Which of `plantings` (expected to already be filtered to one bed) have
 * their own center point fall outside that bed's local footprint
 * `(0,0)-(widthCm,heightCm)` - used to *warn* (not silently re-clamp/move)
 * when a bed resize leaves existing plantings stranded outside its new
 * bounds (see the "plantings drifting outside their bed" backlog item,
 * #198 - there was no such invariant enforced anywhere before this). */
export function plantingsOutsideBounds<T extends { geometry: Geometry }>(
  plantings: T[],
  widthCm: number,
  heightCm: number,
): T[] {
  return plantings.filter((p) => {
    const center = plantingCenter(p.geometry);
    return center.x < 0 || center.x > widthCm || center.y < 0 || center.y > heightCm;
  });
}

/** Straight-line distance (cm) between two points - used for the polygon
 * vertex-drag dimension readout (distance to each neighboring vertex, see
 * PolygonEditor.tsx) and generically available for any other point-distance
 * need. */
export function distanceBetweenPoints(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export type Bounds = { x: number; y: number; width: number; height: number };

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Clamps a single point (e.g. a polygon vertex) to lie within `bounds` -
 * used for bed-within-garden containment. Approximates the garden's own
 * shape by its axis-aligned bounding box rather than exact polygon-in-
 * polygon containment (garden boundaries are typically close to
 * axis-aligned rectangles in practice, and true polygon clipping is out of
 * scope for a frontend-only drag/resize-time constraint - see the "Bed
 * placement must stay within the garden's boundary" backlog item). */
export function clampPointToBounds(point: { x: number; y: number }, bounds: Bounds): { x: number; y: number } {
  return {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height),
  };
}

/** Clamps a rectangle's top-left position (rotation ignored, same
 * simplification `boundingRect` already makes for rectangles) so its
 * unrotated width/height footprint stays within `bounds`. If the rectangle
 * is larger than `bounds` on an axis, pins to the bounds' own origin on
 * that axis rather than distorting size - a drag shouldn't also resize the
 * shape, only a transform/resize gesture should ever change width/height. */
export function clampRectPositionToBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: Bounds,
): { x: number; y: number } {
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - height);
  return { x: clamp(x, bounds.x, maxX), y: clamp(y, bounds.y, maxY) };
}

/** Axis-aligned bounding-box overlap test - used for the "beds must not
 * intersect each other" constraint. Same bounding-box approximation as the
 * garden-boundary-containment helpers above (rotation ignored, polygon beds
 * reduced to their bounding box) rather than exact rotated-rectangle/
 * polygon collision (SAT etc.) - out of scope for a frontend-only
 * drag/resize-time hard constraint. Touching edges (no area overlap) don't
 * count as intersecting. */
export function rectanglesOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Normalizes two arbitrary drag corners into an axis-aligned rect (x/y is
 * always the top-left corner) regardless of which direction the drag went -
 * used for marquee/rubber-band selection, where (unlike a field placement,
 * see `fieldGeometryFromDrag`) there's no minimum-size floor: even a
 * same-point down/up is a valid (empty) marquee, treated as "click on empty
 * space to clear the selection" by the caller. */
export function normalizedRect(start: { x: number; y: number }, end: { x: number; y: number }): Bounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Shifts either geometry variant by a fixed (dx, dy) offset - used for
 * multi-select group moves (see PlantPlacementLayer/Layout.tsx's bulk
 * planting move): the dragged marker's own new geometry comes from Konva as
 * usual, and every *other* selected planting is translated by the same
 * delta rather than independently re-derived from a drag gesture of its
 * own. */
export function translateGeometry(geometry: Geometry, dx: number, dy: number): Geometry {
  if (geometry.type === "rectangle") {
    return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
  }
  return { ...geometry, points: geometry.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** Screen-px distance within which a dragged bed's edge/center snaps into
 * alignment with another bed's matching edge/center - a design-tool "smart
 * guides" style snap, distinct from (and applied after, so it can override)
 * the fixed-cm grid snap. Expressed in screen px, not cm, so the snap
 * *feels* the same regardless of zoom - callers convert to a world/cm
 * threshold via the current viewport scale (`ALIGNMENT_SNAP_THRESHOLD_PX /
 * viewport.scale`) before calling `findAlignmentSnap`. */
export const ALIGNMENT_SNAP_THRESHOLD_PX = 6;

/** A rectangle's near edge, center, and far edge along one axis - generic
 * over which axis (`min`/`size` are x/width for horizontal alignment, y/
 * height for vertical) so `findAlignmentSnap` below can run the same
 * candidate-matching logic for both axes. */
function edgePositions(min: number, size: number): number[] {
  return [min, min + size / 2, min + size];
}

/** Finds the closest edge/center alignment (world/cm) between `rect` and
 * any of `others`, independently on each axis, and returns the position
 * `rect` should snap to so the matching edge/center lines up exactly -
 * dragging a bed near another bed's left/right edge or shared center, the
 * way a design tool's smart guides work (see the "grid-snap + alignment
 * snapping" backlog item). Only a rectangle's *position* is adjusted here,
 * never its size. Rotation is ignored (same bounding-box approximation
 * `rectanglesOverlap`/`clampRectPositionToBounds` already make for beds).
 * Returns `rect`'s own (x, y) unchanged on whichever axis has nothing in
 * `others` within `thresholdCm`. */
export function findAlignmentSnap(rect: Bounds, others: Bounds[], thresholdCm: number): { x: number; y: number } {
  let x = rect.x;
  let bestXDiff = thresholdCm;
  let y = rect.y;
  let bestYDiff = thresholdCm;

  const rectXs = edgePositions(rect.x, rect.width);
  const rectYs = edgePositions(rect.y, rect.height);

  for (const other of others) {
    const otherXs = edgePositions(other.x, other.width);
    const otherYs = edgePositions(other.y, other.height);
    for (const rx of rectXs) {
      for (const ox of otherXs) {
        const diff = Math.abs(rx - ox);
        if (diff < bestXDiff) {
          bestXDiff = diff;
          x = rect.x + (ox - rx);
        }
      }
    }
    for (const ry of rectYs) {
      for (const oy of otherYs) {
        const diff = Math.abs(ry - oy);
        if (diff < bestYDiff) {
          bestYDiff = diff;
          y = rect.y + (oy - ry);
        }
      }
    }
  }

  return { x, y };
}
