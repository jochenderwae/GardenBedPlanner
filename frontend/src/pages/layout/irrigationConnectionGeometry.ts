// #250: coordinate-space-agnostic anchor/curve math extracted out of the
// now-retired `PipeNetworkDialog.tsx` (#209 -> #252/#253/#256) so
// `IrrigationLayer.tsx`'s real-garden-space rendering can reuse it verbatim
// instead of rebuilding it - see product-owner/research/irrigation-editor-merge.md
// section 4 for the full rationale. Every function here takes a plain
// `width`/`height` (node size) and `Position` (`{x, y}`) as numeric inputs -
// none of them know or care whether those numbers came from the old 560x480
// schematic `Stage` or the real garden canvas's viewport-transformed cm->px
// space, so the same functions serve both a small fixed-screen-size icon at
// a real cm position and (previously) a fixed 120x56 schematic box.

export type Position = { x: number; y: number };

/** A point on a `width`x`height` rectangle's own perimeter, `t` the
 * fractional distance clockwise from top-middle (t=0) - spaces anchor
 * points evenly around a node's border regardless of its aspect ratio.
 * Returned relative to the rect's own center. */
export function pointOnRectPerimeter(width: number, height: number, t: number): Position {
  const halfW = width / 2;
  const halfH = height / 2;
  const perimeter = 2 * (width + height);
  let d = (((t % 1) + 1) % 1) * perimeter;
  const topRight = width / 2;
  if (d <= topRight) return { x: d, y: -halfH };
  d -= topRight;
  if (d <= height) return { x: halfW, y: -halfH + d };
  d -= height;
  if (d <= width) return { x: halfW - d, y: halfH };
  d -= width;
  if (d <= height) return { x: -halfW, y: halfH - d };
  d -= height;
  return { x: -halfW + d, y: -halfH };
}

/** Absolute screen/world position of anchor `index` (of `count` total,
 * evenly spaced per `pointOnRectPerimeter`) on a node centered at `center`
 * (#253) - the single source of truth both a node's own anchor-circle
 * rendering and a connection edge's actual endpoint use, so a connection
 * line always terminates exactly on a drawn anchor circle instead of an
 * unrelated node-to-node border-crossing point. */
export function anchorPosition(width: number, height: number, center: Position, index: number, count: number): Position {
  const offset = pointOnRectPerimeter(width, height, index / count);
  return { x: center.x + offset.x, y: center.y + offset.y };
}

/** The outward-facing unit normal at fractional perimeter position `t` on a
 * `width`x`height` rect - i.e. which of the 4 sides `t` currently lands on
 * (walking the same clockwise-from-top-middle path `pointOnRectPerimeter`
 * itself walks, so the two always agree on which side owns a given `t`),
 * independent of the rect's actual size. #256: a physical fitting's port
 * has a fixed direction the pipe leaves it in - straight out from whichever
 * face it's mounted on - so this is the "fixed exit direction" a curved
 * connection needs at each end, not a from-scratch geometry concept. */
export function outwardNormalOnRectPerimeter(width: number, height: number, t: number): Position {
  const perimeter = 2 * (width + height);
  let d = (((t % 1) + 1) % 1) * perimeter;
  const topRight = width / 2;
  if (d <= topRight) return { x: 0, y: -1 };
  d -= topRight;
  if (d <= height) return { x: 1, y: 0 };
  d -= height;
  if (d <= width) return { x: 0, y: 1 };
  d -= width;
  if (d <= height) return { x: -1, y: 0 };
  return { x: 0, y: -1 };
}

/** Anchor `index` (of `count`)'s own fixed exit direction - the same
 * `index`/`count` pair `anchorPosition` itself takes, so a connection's
 * curve leaves each anchor in exactly the direction that anchor's own dot
 * is drawn facing. */
export function anchorNormal(width: number, height: number, index: number, count: number): Position {
  return outwardNormalOnRectPerimeter(width, height, index / count);
}

export function cubicBezierPoint(p0: Position, p1: Position, p2: Position, p3: Position, t: number): Position {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

// #256: "how much pipe a curved run actually consumes" needs the curve's
// own arc length, not the straight-line distance between its two anchors -
// a closed-form cubic-bezier arc length doesn't exist in general, so this
// approximates it the same way any practical renderer does: sample the
// curve at N evenly-spaced `t` steps and sum the straight-line distance
// between consecutive samples. 24 segments is comfortably more than enough
// precision for this ticket's own "How to test" section (directionally
// correct - longer/more-curved runs report more), and now that
// `IrrigationLayer.tsx` feeds this real cm positions (#250, superseding the
// old schematic-only diagram), the result is a genuine physical-length
// approximation, not just a relative "units" figure.
const BEZIER_LENGTH_SAMPLES = 24;

export function cubicBezierLength(p0: Position, p1: Position, p2: Position, p3: Position): number {
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= BEZIER_LENGTH_SAMPLES; i++) {
    const point = cubicBezierPoint(p0, p1, p2, p3, i / BEZIER_LENGTH_SAMPLES);
    length += Math.hypot(point.x - prev.x, point.y - prev.y);
    prev = point;
  }
  return length;
}

export interface ConnectionGeometry {
  start: Position;
  end: Position;
  cp1: Position;
  cp2: Position;
  /** Arc length in whatever unit `start`/`end` were given in - cm on the
   * real-canvas `IrrigationLayer` (a genuine physical pipe length as of
   * #250), was schematic "pipe length units" on the old dialog. */
  length: number;
}

/** How a curve's control points push out from their anchors, and how
 * duplicate connections between the same node pair separate visually - the
 * one part of this module that genuinely differs between a small
 * fixed-screen-size real-canvas icon and the old dialog's much larger fixed
 * schematic box, so callers supply their own tuned values rather than this
 * module hardcoding one node size's constants (see
 * `product-owner/research/irrigation-editor-merge.md` section 4 - these need
 * to scale with the real canvas's own zoom, unlike the dialog's un-zoomable
 * `Stage`). */
export interface ConnectionCurveTuning {
  /** Control point distance as a fraction of the straight-line anchor-to-
   * anchor distance, before `controlMin`/`controlMax` clamping. */
  controlFraction: number;
  controlMin: number;
  controlMax: number;
  /** How far apart duplicate connections between the same instance pair
   * push their curves from each other, perpendicular to the straight line
   * between anchors. */
  duplicateOffsetStep: number;
}

/** The full curved path (and its consumed length) for one connection - a
 * cubic bezier whose two control points sit out from `start`/`end` along
 * each anchor's own `anchorNormal`, so the curve genuinely leaves each
 * fitting in its fixed physical direction rather than cutting a straight
 * line through it (#256's core ask). */
export function connectionGeometry(
  start: Position,
  end: Position,
  startNormal: Position,
  endNormal: Position,
  duplicateIndex: number,
  tuning: ConnectionCurveTuning,
): ConnectionGeometry {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const controlDist = Math.min(tuning.controlMax, Math.max(tuning.controlMin, distance * tuning.controlFraction));
  const perpX = -dy / distance;
  const perpY = dx / distance;
  const dupSign = duplicateIndex % 2 === 1 ? 1 : -1;
  const dupOffset = duplicateIndex > 0 ? tuning.duplicateOffsetStep * Math.ceil(duplicateIndex / 2) : 0;
  const cp1: Position = {
    x: start.x + startNormal.x * controlDist + perpX * dupSign * dupOffset,
    y: start.y + startNormal.y * controlDist + perpY * dupSign * dupOffset,
  };
  const cp2: Position = {
    x: end.x + endNormal.x * controlDist + perpX * dupSign * dupOffset,
    y: end.y + endNormal.y * controlDist + perpY * dupSign * dupOffset,
  };
  return { start, end, cp1, cp2, length: cubicBezierLength(start, cp1, cp2, end) };
}

/** The real physical port count from the matched `IrrigationPartType`
 * catalog row when one exists (#252) - e.g. a nozzle shows exactly 1 anchor
 * and a T-junction exactly 3, so once every port already backs a connection
 * there's no spare hollow anchor left to drag a new connection from. Falls
 * back to #209's original heuristic (always one more than currently
 * connected, capped at 6) for a part_type with no matching catalog row.
 * `Math.max(portCount, connectionCount)` guards the (should-not-normally-
 * happen) case where more connections exist than the type's own port
 * count, so every real connection still gets a rendered anchor rather than
 * being silently dropped. */
export function anchorCountFor(connectionCount: number, portCount: number | undefined): number {
  if (portCount != null) return Math.max(portCount, connectionCount);
  return Math.min(6, Math.max(2, connectionCount + 1));
}

/** Groups connections by their unordered instance-id pair so duplicate
 * connections between the same two instances (legitimate - each is one
 * physical joint) can be rendered as distinct bowed lines instead of
 * perfectly overlapping. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

interface ConnectionLike {
  id?: number | null;
  from_instance_id: number;
  to_instance_id: number;
}

/** #253: no backend field records which specific anchor a connection
 * occupies - derived instead, per instance, by sorting that instance's own
 * touching connections by id and using position in that sorted list as the
 * anchor slot (clamped to the instance's own current anchor count by
 * `anchorSlotFor` below). Stable across renders (connection ids never
 * change), and a newly-created connection - always the highest id - lands
 * on the last remaining hollow anchor, matching what was actually visually
 * hollow at drop time. Keyed `${instanceId}:${connectionId}`. */
export function computeAnchorSlots(connections: ConnectionLike[]): Map<string, number> {
  const perInstance = new Map<number, number[]>();
  for (const c of connections) {
    if (c.id == null) continue;
    for (const instanceId of [c.from_instance_id, c.to_instance_id]) {
      const list = perInstance.get(instanceId);
      if (list) list.push(c.id);
      else perInstance.set(instanceId, [c.id]);
    }
  }
  const result = new Map<string, number>();
  for (const [instanceId, ids] of perInstance) {
    const sorted = [...ids].sort((a, b) => a - b);
    sorted.forEach((connectionId, index) => result.set(`${instanceId}:${connectionId}`, index));
  }
  return result;
}

export function anchorSlotFor(slots: Map<string, number>, instanceId: number, connectionId: number, anchorCount: number): number {
  const raw = slots.get(`${instanceId}:${connectionId}`) ?? 0;
  return Math.min(raw, anchorCount - 1);
}

/** Duplicate-edge bowing (#209): index within each unordered-pair group
 * (`pairKey`) drives `connectionGeometry`'s bow direction/size, so 2+
 * connections between the same pair of instances render as visually
 * distinct curves instead of overlapping exactly. */
export function computeDuplicateIndex(connections: ConnectionLike[]): Map<number, number> {
  const groups = new Map<string, number[]>();
  for (const c of connections) {
    if (c.id == null) continue;
    const key = pairKey(c.from_instance_id, c.to_instance_id);
    const list = groups.get(key) ?? [];
    list.push(c.id);
    groups.set(key, list);
  }
  const indexById = new Map<number, number>();
  for (const ids of groups.values()) {
    ids.forEach((id, i) => indexById.set(id, i));
  }
  return indexById;
}
