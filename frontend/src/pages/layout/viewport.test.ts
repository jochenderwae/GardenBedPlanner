import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEWPORT,
  clampScale,
  fitViewport,
  pickTickSpacingCm,
  screenToWorld,
  visibleWorldBounds,
  worldToScreen,
  zoomAtPoint,
} from "./viewport";

describe("clampScale", () => {
  it("leaves in-range scales unchanged", () => {
    expect(clampScale(1)).toBe(1);
  });

  it("clamps to the default min/max", () => {
    expect(clampScale(0.001)).toBe(0.1);
    expect(clampScale(50)).toBe(5);
  });

  it("accepts custom min/max bounds", () => {
    expect(clampScale(0.5, 1, 2)).toBe(1);
    expect(clampScale(5, 1, 2)).toBe(2);
  });
});

describe("screenToWorld / worldToScreen", () => {
  it("round-trips a point through both conversions", () => {
    const viewport = { x: 50, y: -20, scale: 2 };
    const screenPoint = { x: 120, y: 80 };
    const worldPoint = screenToWorld(screenPoint, viewport);
    expect(worldToScreen(worldPoint, viewport)).toEqual(screenPoint);
  });

  it("applies pan and scale correctly", () => {
    const viewport = { x: 10, y: 10, scale: 2 };
    expect(screenToWorld({ x: 10, y: 10 }, viewport)).toEqual({ x: 0, y: 0 });
    expect(worldToScreen({ x: 5, y: 5 }, viewport)).toEqual({ x: 20, y: 20 });
  });

  it("is the identity at the default viewport", () => {
    expect(screenToWorld({ x: 42, y: 7 }, DEFAULT_VIEWPORT)).toEqual({ x: 42, y: 7 });
  });
});

describe("zoomAtPoint", () => {
  it("keeps the world point under the pointer fixed on screen", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const pointerScreen = { x: 100, y: 100 };
    const worldBefore = screenToWorld(pointerScreen, viewport);

    const nextViewport = zoomAtPoint(viewport, pointerScreen, 2);
    const worldAfter = screenToWorld(pointerScreen, nextViewport);

    expect(nextViewport.scale).toBe(2);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it("clamps the requested scale", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    expect(zoomAtPoint(viewport, { x: 0, y: 0 }, 100).scale).toBe(5);
    expect(zoomAtPoint(viewport, { x: 0, y: 0 }, 0.001).scale).toBe(0.1);
  });
});

describe("fitViewport", () => {
  it("returns the default viewport when there is nothing to fit", () => {
    expect(fitViewport([], { width: 800, height: 600 })).toEqual(DEFAULT_VIEWPORT);
  });

  it("fits a single box within the canvas with margin, centered", () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const viewport = fitViewport([box], { width: 200, height: 200 }, 20);
    // available space is 160x160 for a 100x100 box -> scale 1.6, clamped by MAX_SCALE(5) so stays 1.6
    expect(viewport.scale).toBeCloseTo(1.6);
    // content centered: x = margin + (available - content*scale)/2 - minX*scale
    expect(viewport.x).toBeCloseTo(20);
    expect(viewport.y).toBeCloseTo(20);
  });

  it("fits the union of multiple boxes", () => {
    const boxes = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 90, y: 90, width: 10, height: 10 },
    ];
    const viewport = fitViewport(boxes, { width: 1000, height: 1000 }, 0);
    // union extent is 100x100 -> scale 10, clamped by MAX_SCALE(5)
    expect(viewport.scale).toBe(5);
  });
});

describe("visibleWorldBounds", () => {
  it("returns the full canvas extent at the default viewport", () => {
    expect(visibleWorldBounds(DEFAULT_VIEWPORT, { width: 400, height: 300 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("accounts for pan and zoom", () => {
    const viewport = { x: -100, y: -50, scale: 2 };
    const bounds = visibleWorldBounds(viewport, { width: 400, height: 300 });
    expect(bounds).toEqual({ x: 50, y: 25, width: 200, height: 150 });
  });
});

describe("pickTickSpacingCm", () => {
  it("picks a coarser spacing when zoomed out", () => {
    expect(pickTickSpacingCm(0.05)).toBe(2000);
  });

  it("picks a finer spacing when zoomed in", () => {
    expect(pickTickSpacingCm(10)).toBe(10);
  });

  it("falls back to the coarsest spacing beyond the nice-spacing table's range", () => {
    expect(pickTickSpacingCm(0.0000001)).toBe(20000);
  });
});
