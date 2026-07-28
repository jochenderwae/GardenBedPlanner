import { describe, expect, it } from "vitest";
import type { Plant, PolygonGeometry, RectangleGeometry } from "@/api/client";
import {
  boundingRect,
  clampPointToBounds,
  clampRectPositionToBounds,
  colorForSlug,
  colorsForBedCategory,
  DEFAULT_PLANTING_DIAMETER_CM,
  defaultPlantSpacing,
  distanceBetweenPoints,
  effectivePlantSpacing,
  fieldGeometryFromDrag,
  fieldMarkerPositions,
  findAlignmentSnap,
  formatDistanceCm,
  normalizedRect,
  normalizeDegrees,
  plantingCenter,
  plantingsOutsideBounds,
  polygonToRectangle,
  rectangleToPolygon,
  rectanglesOverlap,
  rectRenderProps,
  rotationFromGardenRelative,
  rotationRelativeToGarden,
  rowGeometryFromDrag,
  rowMarkerPositions,
  snapToGrid,
  translateGeometry,
} from "./geometry";

describe("snapToGrid", () => {
  it("rounds to the nearest multiple of the default snap size", () => {
    expect(snapToGrid(4)).toBe(0);
    expect(snapToGrid(6)).toBe(10);
    expect(snapToGrid(15)).toBe(20);
  });

  it("accepts a custom grid size", () => {
    expect(snapToGrid(24, 50)).toBe(0);
    expect(snapToGrid(26, 50)).toBe(50);
  });

  it("handles negative values", () => {
    expect(snapToGrid(-6)).toBe(-10);
  });
});

describe("normalizeDegrees", () => {
  it("leaves in-range angles untouched", () => {
    expect(normalizeDegrees(45)).toBe(45);
    expect(normalizeDegrees(0)).toBe(0);
  });

  it("wraps angles >= 360", () => {
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(725)).toBe(5);
  });

  it("wraps negative angles into [0, 360)", () => {
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(-360)).toBe(0);
  });
});

describe("rotationRelativeToGarden / rotationFromGardenRelative", () => {
  it("round-trips through both conversions", () => {
    const absolute = 200;
    const gardenOrientation = 30;
    const relative = rotationRelativeToGarden(absolute, gardenOrientation);
    expect(relative).toBe(170);
    expect(rotationFromGardenRelative(relative, gardenOrientation)).toBe(absolute);
  });

  it("normalizes results into [0, 360)", () => {
    expect(rotationRelativeToGarden(10, 350)).toBe(20);
    expect(rotationFromGardenRelative(350, 30)).toBe(20);
  });
});

describe("colorForSlug / colorsForBedCategory", () => {
  it("is deterministic for the same input", () => {
    expect(colorForSlug("tomato")).toBe(colorForSlug("tomato"));
    expect(colorsForBedCategory("berries")).toEqual(colorsForBedCategory("berries"));
  });

  it("falls back to the default colors when category is missing", () => {
    expect(colorsForBedCategory(null)).toEqual({ fill: "#d7e4d5", stroke: "#5b8c5a" });
    expect(colorsForBedCategory(undefined)).toEqual({ fill: "#d7e4d5", stroke: "#5b8c5a" });
    expect(colorsForBedCategory("")).toEqual({ fill: "#d7e4d5", stroke: "#5b8c5a" });
  });

  it("produces different colors for different categories (no accidental collision for these inputs)", () => {
    expect(colorsForBedCategory("berries")).not.toEqual(colorsForBedCategory("compost"));
  });
});

describe("rowGeometryFromDrag", () => {
  it("returns null for a drag shorter than the minimum row length", () => {
    expect(rowGeometryFromDrag({ x: 0, y: 0 }, { x: 5, y: 0 }, 20)).toBeNull();
  });

  it("builds a rectangle centered on the drag line for a horizontal drag", () => {
    const geometry = rowGeometryFromDrag({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(geometry).toEqual({ type: "rectangle", x: 0, y: -10, width: 100, height: 20, rotation: 0 });
  });

  it("derives rotation from the drag angle", () => {
    const geometry = rowGeometryFromDrag({ x: 0, y: 0 }, { x: 0, y: 100 }, 20);
    expect(geometry?.rotation).toBeCloseTo(90);
    expect(geometry?.width).toBeCloseTo(100);
  });
});

describe("fieldGeometryFromDrag", () => {
  it("returns null when either axis is below the minimum field size", () => {
    expect(fieldGeometryFromDrag({ x: 0, y: 0 }, { x: 5, y: 100 })).toBeNull();
  });

  it("normalizes corner order regardless of drag direction", () => {
    const geometry = fieldGeometryFromDrag({ x: 100, y: 100 }, { x: 0, y: 0 });
    expect(geometry).toEqual({ type: "rectangle", x: 0, y: 0, width: 100, height: 100, rotation: 0 });
  });
});

describe("rowMarkerPositions", () => {
  it("evenly centers points along an unrotated row's length", () => {
    const geometry: RectangleGeometry = { type: "rectangle", x: 0, y: -10, width: 90, height: 20, rotation: 0 };
    const points = rowMarkerPositions(geometry, 30);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.x)).toEqual([15, 45, 75]);
    // Centered on the row's own thickness (height / 2), offset by the
    // rectangle's own y.
    expect(points.every((p) => p.y === 0)).toBe(true);
  });

  it("always returns at least one point, even narrower than one spacing interval", () => {
    const geometry: RectangleGeometry = { type: "rectangle", x: 0, y: 0, width: 10, height: 20, rotation: 0 };
    const points = rowMarkerPositions(geometry, 30);
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 5, y: 10 });
  });

  it("accounts for the row's own rotation", () => {
    const geometry: RectangleGeometry = { type: "rectangle", x: 0, y: 0, width: 100, height: 20, rotation: 90 };
    const points = rowMarkerPositions(geometry, 50);
    // Rotated 90deg: local +x becomes world +y, local +y (the thickness
    // offset) becomes world -x.
    for (const p of points) {
      expect(p.x).toBeCloseTo(-10);
    }
    expect(points.map((p) => p.y).sort((a, b) => a - b)).toEqual([25, 75]);
  });
});

describe("fieldMarkerPositions", () => {
  it("fills a grid across both axes", () => {
    const geometry: RectangleGeometry = { type: "rectangle", x: 0, y: 0, width: 60, height: 60, rotation: 0 };
    const points = fieldMarkerPositions(geometry, 30);
    expect(points).toHaveLength(4);
    expect(points).toEqual(
      expect.arrayContaining([
        { x: 15, y: 15 },
        { x: 45, y: 15 },
        { x: 15, y: 45 },
        { x: 45, y: 45 },
      ]),
    );
  });

  it("always returns at least one point for a field smaller than one spacing interval on either axis", () => {
    const geometry: RectangleGeometry = { type: "rectangle", x: 0, y: 0, width: 10, height: 10, rotation: 0 };
    expect(fieldMarkerPositions(geometry, 30)).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("rectRenderProps", () => {
  it("passes rectangles through unchanged", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 1, y: 2, width: 3, height: 4, rotation: 45 };
    expect(rectRenderProps(rect)).toEqual(rect);
  });

  it("falls back to the bounding box (rotation 0) for polygons", () => {
    const polygon: PolygonGeometry = {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    expect(rectRenderProps(polygon)).toEqual({ x: 0, y: 0, width: 10, height: 10, rotation: 0 });
  });
});

describe("boundingRect", () => {
  it("returns the rectangle itself as x/y/width/height", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 5, y: 6, width: 7, height: 8, rotation: 90 };
    expect(boundingRect(rect)).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });

  it("computes the axis-aligned bounding box of a polygon", () => {
    const polygon: PolygonGeometry = {
      type: "polygon",
      points: [
        { x: -5, y: 2 },
        { x: 15, y: -3 },
        { x: 8, y: 20 },
      ],
    };
    expect(boundingRect(polygon)).toEqual({ x: -5, y: -3, width: 20, height: 23 });
  });
});

describe("rectangleToPolygon / polygonToRectangle", () => {
  it("converts an unrotated rectangle to its 4 corners", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 0, y: 0, width: 10, height: 20, rotation: 0 };
    const polygon = rectangleToPolygon(rect);
    expect(polygon.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it("bakes rotation into the resulting corner positions", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 0, y: 0, width: 10, height: 0, rotation: 90 };
    const polygon = rectangleToPolygon(rect);
    // Rotating a purely-horizontal edge 90deg should make it purely vertical.
    expect(polygon.points[1].x).toBeCloseTo(0);
    expect(polygon.points[1].y).toBeCloseTo(10);
  });

  it("round-trips an axis-aligned rectangle through polygonToRectangle", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 3, y: 4, width: 12, height: 6, rotation: 0 };
    const polygon = rectangleToPolygon(rect);
    expect(polygonToRectangle(polygon)).toEqual({ type: "rectangle", x: 3, y: 4, width: 12, height: 6, rotation: 0 });
  });
});

describe("formatDistanceCm", () => {
  it("formats whole meters without a decimal", () => {
    expect(formatDistanceCm(100)).toBe("1m");
    expect(formatDistanceCm(200)).toBe("2m");
  });

  it("formats partial meters with one decimal", () => {
    expect(formatDistanceCm(150)).toBe("1.5m");
    expect(formatDistanceCm(30)).toBe("0.3m");
  });
});

describe("distanceBetweenPoints", () => {
  it("computes the straight-line distance between two points", () => {
    expect(distanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("returns 0 for coincident points", () => {
    expect(distanceBetweenPoints({ x: 10, y: -5 }, { x: 10, y: -5 })).toBe(0);
  });
});

describe("clampPointToBounds", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 };

  it("leaves a point inside bounds unchanged", () => {
    expect(clampPointToBounds({ x: 10, y: 10 }, bounds)).toEqual({ x: 10, y: 10 });
  });

  it("clamps a point outside bounds to the nearest edge", () => {
    expect(clampPointToBounds({ x: -5, y: 60 }, bounds)).toEqual({ x: 0, y: 50 });
    expect(clampPointToBounds({ x: 200, y: -5 }, bounds)).toEqual({ x: 100, y: 0 });
  });
});

describe("clampRectPositionToBounds", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 };

  it("leaves a rectangle fully inside bounds unchanged", () => {
    expect(clampRectPositionToBounds(10, 10, 20, 20, bounds)).toEqual({ x: 10, y: 10 });
  });

  it("clamps position so the rectangle's footprint stays within bounds", () => {
    expect(clampRectPositionToBounds(95, 95, 20, 20, bounds)).toEqual({ x: 80, y: 80 });
    expect(clampRectPositionToBounds(-10, -10, 20, 20, bounds)).toEqual({ x: 0, y: 0 });
  });

  it("pins to the bounds origin when the rectangle is larger than the bounds", () => {
    expect(clampRectPositionToBounds(-10, -10, 200, 200, bounds)).toEqual({ x: 0, y: 0 });
  });
});

describe("rectanglesOverlap", () => {
  it("detects overlapping rectangles", () => {
    expect(rectanglesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it("returns false for non-overlapping rectangles", () => {
    expect(rectanglesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 })).toBe(
      false,
    );
  });

  it("treats merely-touching edges as not overlapping", () => {
    expect(rectanglesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(
      false,
    );
  });
});

describe("normalizedRect", () => {
  it("normalizes a drag that went top-left to bottom-right", () => {
    expect(normalizedRect({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });

  it("normalizes a drag that went the opposite direction (bottom-right to top-left)", () => {
    expect(normalizedRect({ x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });

  it("returns a zero-size rect for a same-point drag", () => {
    expect(normalizedRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe("findAlignmentSnap", () => {
  it("snaps to a left-edge alignment within the threshold", () => {
    // Dragged rect's left edge (x=52) is 2cm from the other rect's left
    // edge (x=50), within a 5cm threshold.
    const rect = { x: 52, y: 200, width: 30, height: 30 };
    const other = { x: 50, y: 0, width: 40, height: 40 };
    expect(findAlignmentSnap(rect, [other], 5)).toEqual({ x: 50, y: 200 });
  });

  it("snaps to a shared center alignment", () => {
    // Other rect spans x=0..40 (center 20); dragged rect's center at
    // x=19 (10..28) is 1cm off that center, within threshold - closer than
    // either edge comparison.
    const rect = { x: 10, y: 0, width: 18, height: 10 };
    const other = { x: 0, y: 100, width: 40, height: 10 };
    expect(findAlignmentSnap(rect, [other], 5).x).toBe(11);
  });

  it("snaps to the closest edge when it beats a further-off center match", () => {
    // Dragged rect's right edge (88) is 2cm from the other's right edge
    // (90), closer than its center (78) is to the other's center (75, 3cm
    // off) - the closer of the two candidate matches wins.
    const rect = { x: 68, y: 0, width: 20, height: 10 };
    const other = { x: 60, y: 500, width: 30, height: 10 };
    expect(findAlignmentSnap(rect, [other], 5)).toEqual({ x: 70, y: 0 });
  });

  it("leaves position unchanged on an axis with nothing in threshold", () => {
    const rect = { x: 100, y: 100, width: 20, height: 20 };
    const other = { x: 0, y: 0, width: 10, height: 10 };
    expect(findAlignmentSnap(rect, [other], 5)).toEqual({ x: 100, y: 100 });
  });

  it("picks the closest match when multiple others are each within threshold", () => {
    // Both others' left edges are within threshold of rect's left edge
    // (100) - farther's (96) by 4cm, closer's (97) by 3cm - regardless of
    // which is checked first, the closer one should win.
    const rect = { x: 100, y: 0, width: 6, height: 6 };
    const farther = { x: 96, y: 500, width: 1000, height: 6 };
    const closer = { x: 97, y: 500, width: 1000, height: 6 };
    expect(findAlignmentSnap(rect, [farther, closer], 5).x).toBe(97);
  });

  it("snaps x and y independently", () => {
    const rect = { x: 12, y: 202, width: 10, height: 10 };
    const other = { x: 10, y: 200, width: 30, height: 30 };
    expect(findAlignmentSnap(rect, [other], 5)).toEqual({ x: 10, y: 200 });
  });
});

describe("translateGeometry", () => {
  it("shifts a rectangle's x/y, leaving width/height/rotation untouched", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 10, y: 20, width: 5, height: 8, rotation: 15 };
    expect(translateGeometry(rect, 3, -4)).toEqual({ type: "rectangle", x: 13, y: 16, width: 5, height: 8, rotation: 15 });
  });

  it("shifts every point of a polygon", () => {
    const polygon: PolygonGeometry = {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(translateGeometry(polygon, 2, 3)).toEqual({
      type: "polygon",
      points: [
        { x: 2, y: 3 },
        { x: 12, y: 3 },
        { x: 12, y: 13 },
      ],
    });
  });
});

describe("plantingCenter", () => {
  it("returns the midpoint of a rectangle geometry", () => {
    const rect: RectangleGeometry = { type: "rectangle", x: 10, y: 20, width: 20, height: 10, rotation: 0 };
    expect(plantingCenter(rect)).toEqual({ x: 20, y: 25 });
  });
});

describe("plantingsOutsideBounds", () => {
  function markerAt(x: number, y: number): { geometry: RectangleGeometry } {
    return { geometry: { type: "rectangle", x, y, width: 20, height: 20, rotation: 0 } };
  }

  it("returns nothing when every planting's center is within the bed's footprint", () => {
    const plantings = [markerAt(0, 0), markerAt(30, 30)];
    expect(plantingsOutsideBounds(plantings, 70, 70)).toEqual([]);
  });

  it("flags a planting whose center falls past the bed's far edge", () => {
    // Center at (60, 60) - just outside a 50x50 bed.
    const plantings = [markerAt(50, 50)];
    expect(plantingsOutsideBounds(plantings, 50, 50)).toEqual(plantings);
  });

  it("flags a planting whose center falls before the bed's near edge (negative x/y)", () => {
    // Center at (-5, 10) - x is negative, outside the bed on that axis.
    const plantings = [markerAt(-15, 0)];
    expect(plantingsOutsideBounds(plantings, 50, 50)).toEqual(plantings);
  });

  it("doesn't flag a marker whose center sits exactly on the bed's edge", () => {
    // Center at (50, 25) - exactly on the right edge of a 50-wide bed, not past it.
    const plantings = [markerAt(40, 15)];
    expect(plantingsOutsideBounds(plantings, 50, 50)).toEqual([]);
  });
});

function makePlant(overrides: Partial<Plant>): Plant {
  return { slug: "tomato", common_name: "Tomato", botanical_name: "Solanum lycopersicum", ...overrides } as Plant;
}

describe("defaultPlantSpacing", () => {
  it("prefers plant_spacing_cm over spread_cm when both are set", () => {
    const plant = makePlant({ plant_spacing_cm: 30, spread_cm: 90 });
    expect(defaultPlantSpacing(plant)).toBe(30);
  });

  it("falls back to spread_cm when plant_spacing_cm isn't set", () => {
    const plant = makePlant({ plant_spacing_cm: null, spread_cm: 90 });
    expect(defaultPlantSpacing(plant)).toBe(90);
  });

  it("is null when neither is set", () => {
    const plant = makePlant({ plant_spacing_cm: null, spread_cm: null });
    expect(defaultPlantSpacing(plant)).toBeNull();
  });

  it("is null for an undefined plant (no plant looked up yet)", () => {
    expect(defaultPlantSpacing(undefined)).toBeNull();
  });
});

describe("effectivePlantSpacing", () => {
  it("an explicit per-placement override always wins over either plant default", () => {
    const plant = makePlant({ plant_spacing_cm: 30, spread_cm: 90 });
    expect(effectivePlantSpacing(15, plant)).toBe(15);
  });

  it("falls back to defaultPlantSpacing when there's no explicit override", () => {
    const plant = makePlant({ plant_spacing_cm: 30, spread_cm: 90 });
    expect(effectivePlantSpacing(null, plant)).toBe(30);
  });

  it("falls back to DEFAULT_PLANTING_DIAMETER_CM when nothing at all is set", () => {
    expect(effectivePlantSpacing(null, undefined)).toBe(DEFAULT_PLANTING_DIAMETER_CM);
  });
});
