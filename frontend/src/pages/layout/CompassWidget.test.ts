import { describe, expect, it } from "vitest";
import { compassBoundingBox, compassCenter, COMPASS_RADIUS_CM } from "./CompassWidget";

describe("compassCenter", () => {
  it("offsets down by the ring's own radius so the ring's top edge, not its center, lines up with the garden's top edge", () => {
    const gardenBounds = { x: 0, y: 100, width: 200, height: 150 };
    const center = compassCenter(gardenBounds);
    expect(center.y - COMPASS_RADIUS_CM).toBe(gardenBounds.y);
  });

  it("sits a fixed margin outside the garden boundary's right edge", () => {
    const gardenBounds = { x: 10, y: 0, width: 200, height: 150 };
    const center = compassCenter(gardenBounds);
    expect(center.x).toBeGreaterThan(gardenBounds.x + gardenBounds.width);
  });
});

describe("compassBoundingBox", () => {
  it("fully contains the ring plus label headroom above it", () => {
    const gardenBounds = { x: 0, y: 100, width: 200, height: 150 };
    const center = compassCenter(gardenBounds);
    const box = compassBoundingBox(gardenBounds);
    // Ring's own bounds (no label headroom) should sit entirely inside the
    // returned box.
    expect(box.x).toBeLessThanOrEqual(center.x - COMPASS_RADIUS_CM);
    expect(box.y).toBeLessThan(center.y - COMPASS_RADIUS_CM);
    expect(box.x + box.width).toBeGreaterThanOrEqual(center.x + COMPASS_RADIUS_CM);
    expect(box.y + box.height).toBeGreaterThanOrEqual(center.y + COMPASS_RADIUS_CM);
  });
});
