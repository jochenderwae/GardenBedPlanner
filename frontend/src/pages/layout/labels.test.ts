import { describe, expect, it } from "vitest";
import { clampLabelYBelowRuler } from "./labels";

describe("clampLabelYBelowRuler", () => {
  it("leaves a y already well below the viewport top unchanged", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    expect(clampLabelYBelowRuler(200, viewport)).toBe(200);
  });

  it("pushes a y at/near the viewport's world origin down below the ruler's tick-label row", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const clamped = clampLabelYBelowRuler(4, viewport);
    expect(clamped).toBeGreaterThan(4);
  });

  it("stays a constant screen-px clearance from the viewport top regardless of zoom", () => {
    const zoomedOut = clampLabelYBelowRuler(4, { x: 0, y: 0, scale: 0.5 });
    const zoomedIn = clampLabelYBelowRuler(4, { x: 0, y: 0, scale: 2 });
    // World-space clamp values differ (clearance / scale), but re-projected
    // to screen px (worldY * scale + viewport.y) they should match, since
    // the clearance itself is a fixed screen-px distance.
    expect(zoomedOut * 0.5).toBeCloseTo(zoomedIn * 2, 5);
  });

  it("accounts for the current pan offset, not just scale", () => {
    const panned = clampLabelYBelowRuler(4, { x: 0, y: -100, scale: 1 });
    const unpanned = clampLabelYBelowRuler(4, { x: 0, y: 0, scale: 1 });
    // Panning the viewport up (negative y) means more world-space y is
    // needed to reach the same on-screen clearance.
    expect(panned).toBeGreaterThan(unpanned);
  });
});
