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

/** Plain, literal on-screen pixel values passed straight to the
 * `Transformer` below - matches `BedNode.tsx`'s own `TRANSFORMER_ANCHOR_*`
 * constants exactly (see that file's own comment for the full mechanism
 * writeup, added by #129's fix). `Transformer` overrides
 * `getAbsoluteTransform()` to just return `this.getTransform()` - it
 * deliberately does NOT compose with the ambient Stage/Layer pan/zoom the
 * way every other node here does - so it already renders `anchorSize`/
 * `anchorStrokeWidth` at a constant on-screen size regardless of zoom, with
 * no manual scale compensation needed. This file used to (incorrectly)
 * divide both by `viewport.scale` (#190) - that's the exact double-
 * compensation bug #129 already fixed once in `BedNode.tsx`/
 * `GardenBoundary.tsx`: dividing an already-constant value by scale is a
 * no-op at 100% zoom (this app's `CM_TO_PX = 1` convention made the bug
 * invisible there) but reintroduces "balloons huge zoomed out, shrinks tiny
 * zoomed in" at any other zoom level. This was the original root cause of
 * the "I couldn't grab the needle" report the world-cm draggable `Circle`
 * this widget used to be also had, for the unrelated reason of a fixed
 * world-cm hit-radius shrinking to sub-pixel at low zoom - both bugs are
 * now fixed via the same "let Konva's own zoom-bypass do its job" principle. */
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
/** The handle's *position* (as opposed to its size above) should sit at the
 * ring's own edge and scale together with the ring as the view zooms, not
 * stay a fixed screen distance away regardless of how big the ring itself
 * is currently drawn. Konva's `Transformer.rotateAnchorOffset` is measured
 * from the wrapped node's own bounding-box edge, not its center, hence
 * subtracting the proxy's own radius to land the handle at exactly
 * `ROTATE_HANDLE_DISTANCE_CM` from the ring's center - both distances here
 * are still world-cm, converted to on-screen pixels via `viewport.scale`
 * at the actual `rotateAnchorOffset` prop below (#190), not left as a raw
 * cm number passed straight through.
 *
 * That conversion is required (not just a nice-to-have) because of how
 * `Transformer` computes anchor positions internally
 * (`node_modules/konva/lib/shapes/Transformer.js`'s `__getNodeRect()`/
 * `update()`): `_getNodeRect()` derives the wrapped proxy node's
 * width/height from that node's own `getAbsoluteTransform()` - which,
 * unlike the `Transformer` itself, *does* compose with the ambient Stage/
 * Layer pan/zoom - so the `edgeX`/`edgeY` the rotate anchor is positioned
 * relative to are already expressed in zoomed/absolute screen pixels, not
 * world-cm. Adding a raw, unscaled `rotateAnchorOffset` on top of an
 * already-zoomed edge position only reads as "the right distance" by
 * coincidence at this app's 100%/`CM_TO_PX = 1` zoom level; multiplying by
 * `viewport.scale` here is what actually makes the handle's gap from the
 * ring track the ring's own on-screen size at every zoom level, the
 * intended behavior the comment above describes. Derived by reading
 * `Transformer`'s own source (not visually verified against a running
 * browser - flagged for a visual check across zoom levels per this
 * ticket's own "How to test" step 4, same as `anchorSize`/
 * `anchorStrokeWidth` above were before #129 confirmed that fix). */
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
          anchorSize={TRANSFORMER_ANCHOR_SIZE_PX}
          anchorStrokeWidth={TRANSFORMER_ANCHOR_STROKE_WIDTH_PX}
          rotateAnchorOffset={ROTATE_ANCHOR_OFFSET_CM * viewport.scale}
        />
      )}
    </>
  );
}
