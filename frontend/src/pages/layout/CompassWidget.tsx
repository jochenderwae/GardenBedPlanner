import { Circle, Line, Text } from "react-konva";
import { normalizeDegrees } from "./geometry";
import { DEFAULT_VIEWPORT, screenToWorld, worldToScreen, type Point, type Viewport } from "./viewport";

/** Radius of the compass ring, in world cm - purely a display/interaction
 * size, unrelated to any real garden dimension. */
export const COMPASS_RADIUS_CM = 36;
/** Gap between the garden boundary's bounding box and the compass's own
 * center, in world cm - "a fixed offset just outside the garden boundary's
 * edge" per the backlog item. */
export const COMPASS_MARGIN_CM = 50;

const RING_COLOR = "#166534";
const NEEDLE_COLOR = "#dc2626";

/** Degrees clockwise from canvas-up (the ring's fixed "N") to `point`, as
 * seen from `center` - the inverse of `pointOnRing` below. */
function angleFromCenter(center: Point, point: Point): number {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** The point on the ring `angleDeg` clockwise from canvas-up. */
function pointOnRing(center: Point, radius: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: center.x + radius * Math.sin(rad), y: center.y - radius * Math.cos(rad) };
}

interface CompassWidgetProps {
  /** Fixed position (world cm), computed by the caller as an offset from
   * the garden boundary's own bounding box. */
  center: Point;
  /** `Garden.orientation_deg` - degrees clockwise from canvas-up to true
   * north. */
  orientationDeg: number;
  onChange: (orientationDeg: number) => void;
  /** Same tab-implied-locking pattern as GardenBoundary/BedNode - only
   * draggable on the Garden tab, still drawn (for spatial context) on
   * every other tab. */
  interactive?: boolean;
  /** See BedNode/GardenBoundary's identical prop doc - `dragBoundFunc`
   * needs the current pan/zoom to snap correctly. */
  viewport?: Viewport;
}

/** A compass widget positioned just outside the garden boundary - a fixed
 * ring marking canvas-up as "N", plus a draggable needle the user rotates
 * around the ring to indicate where true north actually is in their garden.
 * The needle's angle (clockwise from canvas-up) is `Garden.orientation_deg`,
 * fed straight into `PUT /api/garden`. */
export function CompassWidget({
  center,
  orientationDeg,
  onChange,
  interactive = true,
  viewport = DEFAULT_VIEWPORT,
}: CompassWidgetProps) {
  const needleTip = pointOnRing(center, COMPASS_RADIUS_CM, orientationDeg);

  return (
    <>
      <Circle x={center.x} y={center.y} radius={COMPASS_RADIUS_CM} stroke={RING_COLOR} strokeWidth={1.5} listening={false} />
      <Text
        x={center.x - 5}
        y={center.y - COMPASS_RADIUS_CM - 15}
        text="N"
        fontSize={11}
        fontStyle="bold"
        fill={RING_COLOR}
        listening={false}
      />
      <Line
        points={[center.x, center.y, needleTip.x, needleTip.y]}
        stroke={NEEDLE_COLOR}
        strokeWidth={2}
        listening={false}
      />
      <Circle
        x={needleTip.x}
        y={needleTip.y}
        radius={5}
        fill={NEEDLE_COLOR}
        draggable={interactive}
        listening={interactive}
        dragBoundFunc={(pos) => {
          const world = screenToWorld(pos, viewport);
          const snapped = pointOnRing(center, COMPASS_RADIUS_CM, angleFromCenter(center, world));
          return worldToScreen(snapped, viewport);
        }}
        onDragEnd={(e) => onChange(angleFromCenter(center, { x: e.target.x(), y: e.target.y() }))}
      />
    </>
  );
}
