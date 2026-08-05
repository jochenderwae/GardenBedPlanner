import { describe, expect, it } from "vitest";
import {
  anchorCountFor,
  anchorNormal,
  anchorPosition,
  anchorSlotFor,
  computeAnchorSlots,
  computeDuplicateIndex,
  connectionGeometry,
  cubicBezierLength,
  cubicBezierPoint,
  outwardNormalOnRectPerimeter,
  pairKey,
  pointOnRectPerimeter,
} from "./irrigationConnectionGeometry";

describe("pointOnRectPerimeter", () => {
  it("starts at top-middle for t=0", () => {
    expect(pointOnRectPerimeter(20, 10, 0)).toEqual({ x: 0, y: -5 });
  });

  it("wraps around for t outside [0, 1)", () => {
    expect(pointOnRectPerimeter(20, 10, 1)).toEqual(pointOnRectPerimeter(20, 10, 0));
    expect(pointOnRectPerimeter(20, 10, -0.25)).toEqual(pointOnRectPerimeter(20, 10, 0.75));
  });
});

describe("anchorPosition", () => {
  it("offsets pointOnRectPerimeter by the node's own center", () => {
    const center = { x: 100, y: 50 };
    expect(anchorPosition(20, 10, center, 0, 4)).toEqual({ x: 100, y: 45 });
  });
});

describe("outwardNormalOnRectPerimeter / anchorNormal", () => {
  it("points straight up at the top-middle anchor", () => {
    expect(outwardNormalOnRectPerimeter(20, 10, 0)).toEqual({ x: 0, y: -1 });
    expect(anchorNormal(20, 10, 0, 4)).toEqual({ x: 0, y: -1 });
  });

  it("points right at the right-middle side", () => {
    // For a 20x10 rect, the right edge starts at perimeter distance
    // width/2 = 10, i.e. t = 10 / 60.
    const t = 10 / (2 * (20 + 10));
    expect(outwardNormalOnRectPerimeter(20, 10, t)).toEqual({ x: 1, y: 0 });
  });
});

describe("cubicBezierPoint / cubicBezierLength", () => {
  it("returns the start point at t=0 and end point at t=1", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: 20, y: 0 };
    const p3 = { x: 30, y: 0 };
    expect(cubicBezierPoint(p0, p1, p2, p3, 0)).toEqual(p0);
    expect(cubicBezierPoint(p0, p1, p2, p3, 1)).toEqual(p3);
  });

  it("approximates a straight line's length as the direct distance", () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 30, y: 0 };
    // Control points collinear with the endpoints - the "curve" is actually
    // straight, so its arc length should equal the direct distance.
    const length = cubicBezierLength(p0, { x: 10, y: 0 }, { x: 20, y: 0 }, p3);
    expect(length).toBeCloseTo(30, 5);
  });
});

describe("connectionGeometry", () => {
  const tuning = { controlFraction: 0.4, controlMin: 5, controlMax: 100, duplicateOffsetStep: 4 };

  it("pushes control points out along each anchor's own normal", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const startNormal = { x: 0, y: -1 };
    const endNormal = { x: 0, y: 1 };
    const geometry = connectionGeometry(start, end, startNormal, endNormal, 0, tuning);
    expect(geometry.start).toEqual(start);
    expect(geometry.end).toEqual(end);
    // Control point 1 pushed "up" (negative y) from start, control point 2
    // pushed "down" (positive y) from end - each along its own fixed exit
    // direction, not toward each other.
    expect(geometry.cp1.y).toBeLessThan(0);
    expect(geometry.cp2.y).toBeGreaterThan(0);
    expect(geometry.length).toBeGreaterThan(0);
  });

  it("clamps the control-point distance between controlMin and controlMax", () => {
    const start = { x: 0, y: 0 };
    const veryClose = { x: 1, y: 0 };
    const startNormal = { x: 0, y: -1 };
    const endNormal = { x: 0, y: 1 };
    const geometry = connectionGeometry(start, veryClose, startNormal, endNormal, 0, tuning);
    // distance * controlFraction (0.4) would be far below controlMin (5) -
    // clamped up to controlMin.
    expect(Math.abs(geometry.cp1.y)).toBeCloseTo(tuning.controlMin, 5);
  });

  it("separates duplicate connections perpendicular to the anchor line", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const startNormal = { x: 0, y: -1 };
    const endNormal = { x: 0, y: 1 };
    const first = connectionGeometry(start, end, startNormal, endNormal, 0, tuning);
    const second = connectionGeometry(start, end, startNormal, endNormal, 1, tuning);
    // start->end is horizontal here, so the perpendicular offset that
    // separates duplicates lands on the y axis, not x.
    expect(second.cp1.y).not.toBeCloseTo(first.cp1.y, 5);
  });
});

describe("anchorCountFor", () => {
  it("uses the real port count when a catalog type matches", () => {
    expect(anchorCountFor(1, 3)).toBe(3);
  });

  it("never returns fewer anchors than there are real connections", () => {
    expect(anchorCountFor(5, 3)).toBe(5);
  });

  it("falls back to the connection-count-plus-one heuristic, capped at 6, with no catalog match", () => {
    expect(anchorCountFor(0, undefined)).toBe(2);
    expect(anchorCountFor(2, undefined)).toBe(3);
    expect(anchorCountFor(10, undefined)).toBe(6);
  });
});

describe("pairKey", () => {
  it("is order-independent", () => {
    expect(pairKey(1, 2)).toBe(pairKey(2, 1));
  });
});

describe("computeAnchorSlots / anchorSlotFor", () => {
  it("assigns stable, sorted-by-connection-id slots per instance", () => {
    const connections = [
      { id: 20, from_instance_id: 1, to_instance_id: 2 },
      { id: 10, from_instance_id: 1, to_instance_id: 3 },
    ];
    const slots = computeAnchorSlots(connections);
    // Instance 1 touches connections 10 and 20 - sorted ascending, so
    // connection 10 gets slot 0 and connection 20 gets slot 1.
    expect(anchorSlotFor(slots, 1, 10, 4)) .toBe(0);
    expect(anchorSlotFor(slots, 1, 20, 4)).toBe(1);
  });

  it("clamps a slot to the instance's current anchor count", () => {
    const slots = computeAnchorSlots([{ id: 5, from_instance_id: 1, to_instance_id: 2 }]);
    expect(anchorSlotFor(slots, 1, 5, 1)).toBe(0);
  });
});

describe("computeDuplicateIndex", () => {
  it("indexes duplicate connections between the same pair, independent of direction", () => {
    const connections = [
      { id: 1, from_instance_id: 1, to_instance_id: 2 },
      { id: 2, from_instance_id: 2, to_instance_id: 1 },
      { id: 3, from_instance_id: 4, to_instance_id: 5 },
    ];
    const index = computeDuplicateIndex(connections);
    expect(index.get(1)).toBe(0);
    expect(index.get(2)).toBe(1);
    expect(index.get(3)).toBe(0);
  });
});
