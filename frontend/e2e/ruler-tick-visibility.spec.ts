import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #115 ("Left tick marks disappear") - a pure
 * z-ordering/visual bug (`RulerLayer` was rendered *beneath* the bed/
 * garden-boundary content Layer, so opaque bed fills painted over the
 * ruler ticks whenever panning brought them across the screen edge the
 * ruler is anchored to) that neither typecheck nor Vitest can observe -
 * the implementer's own outcome comment explicitly asks for this exact
 * scenario to be re-checked in a real browser.
 *
 * Same real-pixel-compositing technique the other canvas specs in this
 * directory use, but instead of checking "something is/isn't there", this
 * scans a region for the ruler tick's specific stroke color (`#374151`)
 * to confirm the ticks are actually visible *on top of* opaque bed content
 * that would otherwise cover them, not just checking for "any content" at
 * all (the bed fill alone would already satisfy that).
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

/** Scans a rectangular CSS-pixel region for any pixel close to `target`
 * RGB, compositing every same-sized Konva layer canvas first (same
 * rationale as the other specs in this directory's `samplePixel`/
 * `sampleRegion` helpers). */
async function regionContainsColor(
  page: Page,
  cssX: number,
  cssY: number,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
  tolerance = 40,
  stepPx = 1,
): Promise<boolean> {
  return page.evaluate(
    ({ cssX, cssY, width, height, target, tolerance, stepPx }) => {
      const all = Array.from(document.querySelectorAll("canvas"));
      const reference = all[0];
      if (!reference) return false;
      const refBox = reference.getBoundingClientRect();
      const layers = all.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left === refBox.left && b.top === refBox.top && b.width === refBox.width && b.height === refBox.height;
      });
      if (layers.length === 0) return false;

      const scratch = document.createElement("canvas");
      scratch.width = reference.width;
      scratch.height = reference.height;
      const sctx = scratch.getContext("2d");
      if (!sctx) return false;
      for (const layer of layers) sctx.drawImage(layer, 0, 0);

      const scaleX = reference.width / refBox.width;
      const scaleY = reference.height / refBox.height;
      for (let dy = 0; dy < height; dy += stepPx) {
        for (let dx = 0; dx < width; dx += stepPx) {
          const localX = Math.round((cssX + dx - refBox.left) * scaleX);
          const localY = Math.round((cssY + dy - refBox.top) * scaleY);
          if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) continue;
          const [r, g, b] = sctx.getImageData(localX, localY, 1, 1).data;
          if (Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance) {
            return true;
          }
        }
      }
      return false;
    },
    { cssX, cssY, width, height, target, tolerance, stepPx },
  );
}

const RULER_TICK_COLOR = { r: 55, g: 65, b: 81 }; // #374151, RulerLayer.tsx's stroke/fill

test.describe("Ruler tick visibility while panning over bed content (#115)", () => {
  test("left-edge ruler ticks stay visible on top of a bed after panning right", async ({ page, request }) => {
    // Wide enough to cover the entire visible canvas width even after a
    // generous pan - guarantees the screen's left edge (where the ruler's
    // Y-axis ticks are anchored) sits on top of opaque bed fill, exactly
    // the scenario the bug report described.
    const bed = await createBed(request, "E2E Ruler Cover Bed", rect(-1000, 0, 3000, 300));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const box = await canvasBox(page);

      // Pan right (middle-mouse-drag, per #14) - reveals more of the
      // garden's west/negative-x side, moving the world coordinate at the
      // screen's left edge from 0 to roughly -400.
      await page.mouse.move(box.x + 300, box.y + 200);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(box.x + 700, box.y + 200, { steps: 15 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(300);

      // Confirm the bed's fill genuinely does now cover the screen's left
      // edge - otherwise this test wouldn't actually be exercising the bug
      // (ruler ticks would trivially be visible over empty background
      // regardless of layer order).
      const bedCoversLeftEdge = await regionContainsColor(page, box.x, box.y + 50, 20, 200, { r: 215, g: 228, b: 213 }, 10);
      expect(bedCoversLeftEdge, "test setup didn't actually put opaque bed fill over the screen's left edge").toBe(true);

      const ticksVisible = await regionContainsColor(page, box.x, box.y, 30, box.height, RULER_TICK_COLOR);
      expect(ticksVisible, "no ruler tick color found along the left edge after panning right over a bed").toBe(true);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("ruler ticks stay visible after panning in each of the other three directions too", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Ruler Cover Bed 2", rect(-1000, -1000, 4000, 4000));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const box = await canvasBox(page);
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      const directions: { name: string; dx: number; dy: number }[] = [
        { name: "left", dx: -300, dy: 0 },
        { name: "up", dx: 0, dy: -200 },
        { name: "down", dx: 0, dy: 200 },
      ];

      for (const { name, dx, dy } of directions) {
        await page.mouse.move(center.x, center.y);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(center.x + dx, center.y + dy, { steps: 10 });
        await page.mouse.up({ button: "middle" });
        await page.waitForTimeout(200);

        const ticksVisible = await regionContainsColor(page, box.x, box.y, 30, box.height, RULER_TICK_COLOR);
        expect(ticksVisible, `no ruler tick color found along the left edge after panning ${name}`).toBe(true);
      }
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
