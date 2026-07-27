import { useEffect, useRef } from "react";
import { Circle, Group, Line, Text, Transformer } from "react-konva";
import type Konva from "konva";
import { normalizeDegrees } from "./geometry";
import { DEFAULT_VIEWPORT, type Box, type Point, type Viewport } from "./viewport";

/** Radius of the compass ring, in world cm - purely a display/interaction
 * size, unrelated to any real garden dimension. */
export const COMPASS_RADIUS_CM = 36;
/** Gap between the garden boundary's bounding box and the compass's own
 * center, in world cm - "a fixed offset just outside the garden boundary's
 * edge" per the backlog item. */
export const COMPASS_MARGIN_CM = 50;

const RING_COLOR = "#166534";
const NEEDLE_FRONT_COLOR = "#dc2626";
const NEEDLE_BACK_COLOR = "#fecaca";

/** Same "divide a fixed on-screen px size by the current zoom" fix
 * `BedNode.tsx` already applies to its own Transformer anchors (see that
 * file's own comment) - keeps the rotate handle a constant, comfortably-
 * grabbable size regardless of how zoomed out the garden view is. This was
 * the root cause of the "I couldn't grab the needle" report: the previous
 * draggable `Circle`'s radius was a fixed *world-cm* value, shrinking to a
 * sub-pixel hit target at any zoom level where the garden doesn't fill the
 * canvas 1:1. */
const TRANSFORMER_ANCHOR_SIZE_PX = 12;
const TRANSFORMER_ANCHOR_STROKE_WIDTH_PX = 1;
/** Radius (world cm) of the invisible proxy node the `Transformer` actually
 * wraps - deliberately a tiny *symmetric* shape (a circle, whose bounding
 * box is always centered on its own x/y) rather than the needle artwork
 * itself, which has a north-heavy silhouette (see the kite shape below)
 * whose bounding-box center doesn't coincide with the ring's true center.
 * Attaching the Transformer directly to an asymmetric shape would make
 * Konva drift that shape's x/y during rotation to keep its (off-center)
 * bounding-box center fixed on screen, visibly detaching the needle from
 * the ring as it rotates - the proxy sidesteps that entirely. */
const HANDLE_PROXY_RADIUS_CM = 4;

/** Gap (world cm) between the ring's own top edge and the "N" label's top
 * edge, and the label's own approximate rendered height (Konva's default
 * ~1.2x-fontSize line-height factor) - both used only to figure out how far
 * out the rotate handle needs to sit to clear the label entirely, and to
 * size `compassBoundingBox`'s headroom. Keep in sync with the "N" `Text`'s
 * own `y`/`fontSize` props below if either ever changes. */
const LABEL_GAP_ABOVE_RING_CM = 15;
const LABEL_FONT_SIZE_CM = 12;
const LABEL_HEIGHT_CM = LABEL_FONT_SIZE_CM * 1.2;
/** Extra daylight (world cm) kept between the rotate handle and the "N"
 * label's own top edge, so the handle sits clearly above/outside it rather
 * than just grazing it - the previous fixed `ROTATE_ANCHOR_OFFSET_CM`
 * placed the handle *inside* the label's own vertical span (#70). */
const HANDLE_LABEL_CLEARANCE_CM = 10;
/** Total distance (world cm) from the ring's own center to the rotate
 * handle - the ring's radius, plus the label's own full headroom above the
 * ring, plus a bit more clearance so the handle clears the label instead of
 * overlapping it. */
const ROTATE_HANDLE_DISTANCE_CM = COMPASS_RADIUS_CM + LABEL_GAP_ABOVE_RING_CM + LABEL_HEIGHT_CM + HANDLE_LABEL_CLEARANCE_CM;
/** The handle's *position* (as opposed to its size above) is deliberately
 * NOT divided by `viewport.scale` - it should sit at the ring's own edge and
 * scale together with the ring as the view zooms, not stay a fixed screen
 * distance away regardless of how big the ring itself is currently drawn.
 * Konva's `Transformer.rotateAnchorOffset` is measured from the wrapped
 * node's own bounding-box edge, not its center, hence subtracting the
 * proxy's own radius to land the handle at exactly `ROTATE_HANDLE_DISTANCE_CM`
 * from the ring's center. */
const ROTATE_ANCHOR_OFFSET_CM = ROTATE_HANDLE_DISTANCE_CM - HANDLE_PROXY_RADIUS_CM;
/** Small buffer (world cm) added on top of the handle's own reach when
 * sizing `compassBoundingBox`'s headroom, covering the handle's own small
 * rendered footprint (`TRANSFORMER_ANCHOR_SIZE_PX`) so "fit to garden"
 * frames the handle fully rather than clipping its edge - the exact class
 * of bug this widget already had fixed once for the ring/needle
 * themselves. */
const HANDLE_VISUAL_BUFFER_CM = 8;
/** Total headroom (world cm) `compassBoundingBox` reserves above the ring -
 * driven by the rotate handle's own reach (the larger of the two, now that
 * the handle sits further out than the label to clear it) plus a small
 * visual buffer. */
const ABOVE_RING_HEADROOM_CM = ROTATE_HANDLE_DISTANCE_CM - COMPASS_RADIUS_CM + HANDLE_VISUAL_BUFFER_CM;

/** The compass widget's own center (world cm), positioned a fixed
 * `COMPASS_MARGIN_CM` outside the garden boundary's right edge, with its
 * *ring's top edge* - not its center - aligned with the garden boundary's
 * own top edge (offset down by the ring's own radius from
 * `gardenBounds.y`) - see the "compass widget" backlog item's visibility
 * fix. Shared by `Layout.tsx`'s render call and `compassBoundingBox` below
 * so both agree on exactly the same position. */
export function compassCenter(gardenBounds: Box): Point {
  return {
    x: gardenBounds.x + gardenBounds.width + COMPASS_MARGIN_CM,
    y: gardenBounds.y + COMPASS_RADIUS_CM,
  };
}

/** The compass widget's own world-space bounding box (ring + label
 * headroom) - fed into `Layout.tsx`'s `handleFitView` box list so the
 * default "fit to garden" view always frames the widget instead of
 * potentially clipping it off-screen (see the "must always be visible"
 * backlog requirement). */
export function compassBoundingBox(gardenBounds: Box): Box {
  const center = compassCenter(gardenBounds);
  return {
    x: center.x - COMPASS_RADIUS_CM,
    y: center.y - COMPASS_RADIUS_CM - ABOVE_RING_HEADROOM_CM,
    width: COMPASS_RADIUS_CM * 2,
    height: COMPASS_RADIUS_CM * 2 + ABOVE_RING_HEADROOM_CM,
  };
}

interface CompassWidgetProps {
  /** Fixed position (world cm) - see `compassCenter` above, which callers
   * should use to compute this rather than re-deriving it inline. */
  center: Point;
  /** `Garden.orientation_deg` - degrees clockwise from canvas-up to true
   * north. */
  orientationDeg: number;
  onChange: (orientationDeg: number) => void;
  /** Same tab-implied-locking pattern as GardenBoundary/BedNode - only
   * rotatable on the Garden tab, still drawn (for spatial context) on
   * every other tab. */
  interactive?: boolean;
  /** See BedNode/GardenBoundary's identical prop doc - the Transformer's
   * anchor needs the current pan/zoom to keep its own rendered *size*
   * constant regardless of zoom (see `TRANSFORMER_ANCHOR_SIZE_PX` above). */
  viewport?: Viewport;
}

/** A compass widget positioned just outside the garden boundary - a fixed
 * ring marking canvas-up as "N" (with E/S/W tick marks) plus a two-tone
 * kite-shaped north-arrow needle the user rotates to indicate where true
 * north actually is in their garden. Rotation is driven by a Konva
 * `Transformer` (rotate-only, resize disabled) attached to a tiny invisible
 * proxy node - the same rotate-handle mechanism `BedNode.tsx` already uses
 * for bed rotation - rather than a bespoke drag-a-point-around-a-circle
 * interaction, per the user's explicit preference. The needle's angle
 * (clockwise from canvas-up) is `Garden.orientation_deg`, fed straight into
 * `PUT /api/garden`. */
export function CompassWidget({
  center,
  orientationDeg,
  onChange,
  interactive = true,
  viewport = DEFAULT_VIEWPORT,
}: CompassWidgetProps) {
  const proxyRef = useRef<Konva.Circle>(null);
  const needleRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (interactive && trRef.current && proxyRef.current) {
      trRef.current.nodes([proxyRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [interactive]);

  // Live-rotate the visible needle during the drag (Konva owns the proxy
  // node's rotation during the gesture, same as every other
  // drag/transform in this editor) - without this the invisible proxy
  // would spin but the needle artwork (driven by `orientationDeg` React
  // state) wouldn't visibly move until the gesture ends.
  function handleTransform() {
    const proxy = proxyRef.current;
    const needle = needleRef.current;
    if (!proxy || !needle) return;
    needle.rotation(proxy.rotation());
    needle.getLayer()?.batchDraw();
  }

  function handleTransformEnd() {
    const proxy = proxyRef.current;
    if (!proxy) return;
    const rotation = normalizeDegrees(proxy.rotation());
    // Reset the proxy's own rotation back to 0 - it's a stateless handle,
    // not the source of truth; the needle's actual rotation comes from
    // `orientationDeg` (React state, updated via `onChange` below) on the
    // next render.
    proxy.rotation(0);
    onChange(rotation);
  }

  // A two-tone "kite" north-arrow - the classic cartographic compass-rose
  // needle shape (a long spike toward N, a short one toward S, front/back
  // halves shaded differently) instead of the previous bare single line,
  // per the "should look like a clean architectural north-arrow" backlog
  // requirement. Points are local to the rotated Group below, so (0, 0) is
  // the ring's own center regardless of the needle's current rotation.
  const kiteFront = [0, -COMPASS_RADIUS_CM, COMPASS_RADIUS_CM * 0.22, 0, 0, COMPASS_RADIUS_CM * 0.3];
  const kiteBack = [0, COMPASS_RADIUS_CM * 0.3, -COMPASS_RADIUS_CM * 0.22, 0, 0, -COMPASS_RADIUS_CM];

  return (
    <>
      <Circle x={center.x} y={center.y} radius={COMPASS_RADIUS_CM} stroke={RING_COLOR} strokeWidth={1.5} listening={false} />
      {/* E/S/W tick marks (N is implied by the needle and label) - a subtle
          compass-rose detail, purely decorative. */}
      {[90, 180, 270].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const inner = {
          x: center.x + (COMPASS_RADIUS_CM - 5) * Math.sin(rad),
          y: center.y - (COMPASS_RADIUS_CM - 5) * Math.cos(rad),
        };
        const outer = { x: center.x + COMPASS_RADIUS_CM * Math.sin(rad), y: center.y - COMPASS_RADIUS_CM * Math.cos(rad) };
        return (
          <Line
            key={deg}
            points={[inner.x, inner.y, outer.x, outer.y]}
            stroke={RING_COLOR}
            strokeWidth={1}
            listening={false}
          />
        );
      })}
      <Text
        x={center.x - 5}
        y={center.y - COMPASS_RADIUS_CM - LABEL_GAP_ABOVE_RING_CM}
        text="N"
        fontSize={LABEL_FONT_SIZE_CM}
        fontStyle="bold"
        fill={RING_COLOR}
        listening={false}
      />
      <Group ref={needleRef} x={center.x} y={center.y} rotation={orientationDeg} listening={false}>
        <Line points={kiteFront} closed fill={NEEDLE_FRONT_COLOR} stroke={NEEDLE_FRONT_COLOR} strokeWidth={1} />
        <Line points={kiteBack} closed fill={NEEDLE_BACK_COLOR} stroke={RING_COLOR} strokeWidth={1} />
      </Group>
      <Circle
        ref={proxyRef}
        x={center.x}
        y={center.y}
        radius={HANDLE_PROXY_RADIUS_CM}
        opacity={0}
        draggable={false}
        listening={interactive}
        onTransform={handleTransform}
        onTransformEnd={handleTransformEnd}
      />
      {interactive && (
        <Transformer
          ref={trRef}
          resizeEnabled={false}
          rotateEnabled
          borderEnabled={false}
          anchorSize={TRANSFORMER_ANCHOR_SIZE_PX / viewport.scale}
          anchorStrokeWidth={TRANSFORMER_ANCHOR_STROKE_WIDTH_PX / viewport.scale}
          rotateAnchorOffset={ROTATE_ANCHOR_OFFSET_CM}
        />
      )}
    </>
  );
}
