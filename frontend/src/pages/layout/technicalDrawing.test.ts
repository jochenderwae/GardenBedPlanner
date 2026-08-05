import { describe, expect, it } from "vitest";
import {
  adjacentMarkerDimensionLines,
  bedEdgeDimensionLines,
  fieldSpacingDimensionLines,
  nearestNeighborDimensionLines,
} from "./technicalDrawing";

describe("bedEdgeDimensionLines", () => {
  it("measures from the bed's left (x=0) and top (y=0) edges to the marker", () => {
    const { horizontal, vertical } = bedEdgeDimensionLines({ x: 30, y: 12 });
    expect(horizontal.from).toEqual({ x: 0, y: 12 });
    expect(horizontal.to).toEqual({ x: 30, y: 12 });
    expect(horizontal.distanceCm).toBe(30);
    expect(vertical.from).toEqual({ x: 30, y: 0 });
    expect(vertical.to).toEqual({ x: 30, y: 12 });
    expect(vertical.distanceCm).toBe(12);
  });
});

describe("adjacentMarkerDimensionLines", () => {
  it("returns one line per consecutive pair, none for fewer than 2 markers", () => {
    expect(adjacentMarkerDimensionLines([{ x: 0, y: 0 }])).toEqual([]);
    const lines = adjacentMarkerDimensionLines([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 25, y: 0 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].distanceCm).toBe(10);
    expect(lines[1].distanceCm).toBe(15);
  });
});

describe("fieldSpacingDimensionLines", () => {
  it("returns one horizontal (within-row) and one vertical (between-row) sample for a multi-cell grid", () => {
    const lines = fieldSpacingDimensionLines({ x: 0, y: 0, width: 40, height: 40 }, 20);
    // 40/20 = 2 segments on each axis -> both a horizontal and vertical sample exist.
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.distanceCm).toBeCloseTo(20, 5);
  });

  it("omits the axis sample when that axis only fits a single segment", () => {
    const lines = fieldSpacingDimensionLines({ x: 0, y: 0, width: 10, height: 40 }, 20);
    // width 10 -> segmentCount 1 (no horizontal pair); height 40 -> segmentCount 2 (one vertical pair).
    expect(lines).toHaveLength(1);
  });

  it("uses an independent row (vertical) spacing when given (#264), defaulting to spacingCm when omitted", () => {
    const withoutOverride = fieldSpacingDimensionLines({ x: 0, y: 0, width: 40, height: 40 }, 20);
    const withExplicitSameValue = fieldSpacingDimensionLines({ x: 0, y: 0, width: 40, height: 40 }, 20, 20);
    expect(withoutOverride).toEqual(withExplicitSameValue);

    const withDifferentRowSpacing = fieldSpacingDimensionLines({ x: 0, y: 0, width: 40, height: 40 }, 20, 10);
    // width 40 / 20cm spacing -> 2 x-segments (unchanged); height 40 / 10cm row spacing -> 4 y-segments,
    // so the vertical sample's own distance reflects the row spacing, not the in-row spacing.
    const vertical = withDifferentRowSpacing.find((l) => l.from.x === l.to.x);
    expect(vertical?.distanceCm).toBeCloseTo(10, 5);
  });
});

describe("nearestNeighborDimensionLines", () => {
  it("returns nothing for 0 or 1 markers", () => {
    expect(nearestNeighborDimensionLines([])).toEqual([]);
    expect(nearestNeighborDimensionLines([{ x: 0, y: 0 }])).toEqual([]);
  });

  it("dedupes a mutual nearest-neighbor pair into a single line", () => {
    const lines = nearestNeighborDimensionLines([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].distanceCm).toBe(10);
  });

  it("gives each marker its own nearest-neighbor line when nearest isn't mutual", () => {
    // A(0,0) -> nearest is B(10,0). B(10,0) -> nearest is C(15,0) (5 away, closer than A's 10).
    // C(15,0) -> nearest is B. Expect A-B and B-C, not A-C.
    const lines = nearestNeighborDimensionLines([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ]);
    expect(lines).toHaveLength(2);
    const distances = lines.map((l) => l.distanceCm).sort((a, b) => a - b);
    expect(distances).toEqual([5, 10]);
  });
});
