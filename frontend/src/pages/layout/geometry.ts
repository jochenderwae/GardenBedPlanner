import type { Geometry, PolygonGeometry, RectangleGeometry } from "@/api/client";

/** 1cm = 1px - real bed sizes (30-200cm) map directly to a readable canvas
 * scale without needing zoom/pan for a first pass. Revisit if/when gardens
 * with a much larger total footprint make this too small or the canvas too
 * large to be usable. */
export const CM_TO_PX = 1;

export const CANVAS_WIDTH_PX = 1400;
export const CANVAS_HEIGHT_PX = 900;
export const GRID_SPACING_CM = 50;
export const DRAG_SNAP_CM = 10;

export function snapToGrid(value: number, gridSizeCm: number = DRAG_SNAP_CM): number {
  return Math.round(value / gridSizeCm) * gridSizeCm;
}

/** Default footprint (cm) for a plant placement when the plant has no
 * spread_cm/row_spacing_cm on file - keeps a planting visible instead of
 * collapsing to a near-invisible dot. */
export const DEFAULT_PLANTING_DIAMETER_CM = 20;

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
