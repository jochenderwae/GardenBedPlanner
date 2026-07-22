import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #15 ("Live dimension labels while dragging/
 * resizing a bed or dragging a polygon vertex") - a purely visual, mid-
 * gesture-only feature (the label only exists while a drag/resize/vertex-
 * drag is actively held, driven by imperative Konva refs + `batchDraw()`,
 * not React state per tick) that neither a typecheck nor a Vitest/jsdom
 * test can observe at all. The implementer's own outcome comment confirms
 * this stopped at build/lint/test-level verification.
 *
 * Same real-pixel-compositing technique `plant-footprint-shapes.spec.ts`
 * (#132) uses (`CanvasRenderingContext2D.getImageData`, composited across
 * every Konva layer's own `<canvas>` in DOM order) - but sampling a small
 * *region* around the label's expected position at three points in time
 * (before the gesture starts, while it's held mid-gesture, and after
 * release) rather than a single pixel, since exact sub-pixel text-glyph
 * targeting isn't reliable. "Content appeared" is "any sampled point in the
 * region differs meaningfully from the pre-gesture baseline at that same
 * position"; "content disappeared" is "the post-release region matches
 * that baseline again".
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Poly = { type: "polygon"; points: { x: number; y: number }[] };
type RGBA = { r: number; g: number; b: number; a: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect | Poly): Promise<{ id: number }> {
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

async function openBedsTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Beds" }).click();
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

/** Composites every same-sized Konva layer canvas (see
 * `plant-footprint-shapes.spec.ts`'s identical helper for the full
 * rationale) and samples a small grid of points across a CSS-pixel region,
 * returning each point's RGBA. */
async function sampleRegion(page: Page, cssX: number, cssY: number, width: number, height: number, stepPx = 3): Promise<RGBA[]> {
  return page.evaluate(
    ({ cssX, cssY, width, height, stepPx }) => {
      const all = Array.from(document.querySelectorAll("canvas"));
      const reference = all[0];
      if (!reference) return [];
      const refBox = reference.getBoundingClientRect();
      const layers = all.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left === refBox.left && b.top === refBox.top && b.width === refBox.width && b.height === refBox.height;
      });
      if (layers.length === 0) return [];

      const scratch = document.createElement("canvas");
      scratch.width = reference.width;
      scratch.height = reference.height;
      const sctx = scratch.getContext("2d");
      if (!sctx) return [];
      for (const layer of layers) sctx.drawImage(layer, 0, 0);

      const scaleX = reference.width / refBox.width;
      const scaleY = reference.height / refBox.height;
      const points: { r: number; g: number; b: number; a: number }[] = [];
      for (let dy = 0; dy < height; dy += stepPx) {
        for (let dx = 0; dx < width; dx += stepPx) {
          const localX = Math.round((cssX + dx - refBox.left) * scaleX);
          const localY = Math.round((cssY + dy - refBox.top) * scaleY);
          if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) continue;
          const [r, g, b, a] = sctx.getImageData(localX, localY, 1, 1).data;
          points.push({ r, g, b, a });
        }
      }
      return points;
    },
    { cssX, cssY, width, height, stepPx },
  );
}

function regionsDiffer(a: RGBA[], b: RGBA[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((pa, i) => {
    const pb = b[i];
    return Math.abs(pa.r - pb.r) > 10 || Math.abs(pa.g - pb.g) > 10 || Math.abs(pa.b - pb.b) > 10 || Math.abs(pa.a - pb.a) > 10;
  });
}

test.describe("Live dimension labels during drag/resize/vertex-drag (#15)", () => {
  test("dragging a bed shows a live dimension label mid-gesture that disappears on release", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Live Label Drag Bed", rect(400, 400, 80, 80));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      // Final drag target: bed moves to (450,430) - label renders at
      // (node.x(), node.y()-16) = (450, 414) once there. Deliberately NOT
      // comparing against a "before the drag started" baseline sampled at
      // this position - the bed hasn't moved there yet at that point, so
      // that position is still inside the *original* bed's own fill,
      // making any before/after comparison meaningless (confirmed via a
      // throwaway probe: the real difference was the bed's fill color
      // disappearing as it moved away, unrelated to the label). Comparing
      // mid-gesture (label held visible) directly against the *settled*
      // post-release state at the very same final on-screen position
      // proves both "a label appeared while dragging" and "it's gone once
      // released" in one clean comparison.
      const labelRegion = { x: box.x + 450, y: box.y + 414, width: 70, height: 14 };

      await page.mouse.move(box.x + 440, box.y + 440); // bed center
      await page.mouse.down();
      await page.mouse.move(box.x + 490, box.y + 470, { steps: 10 });
      // Still held - the label should be visible right now, before release.
      const midGesture = await sampleRegion(page, labelRegion.x, labelRegion.y, labelRegion.width, labelRegion.height);

      await page.mouse.up();
      await page.waitForTimeout(200);
      const afterRelease = await sampleRegion(page, labelRegion.x, labelRegion.y, labelRegion.width, labelRegion.height);
      expect(
        regionsDiffer(midGesture, afterRelease),
        "no visible difference between mid-drag and after-release at the label's position - either it never appeared, or never disappeared",
      ).toBe(true);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("resizing a bed shows a live dimension label mid-gesture that disappears on release", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Live Label Resize Bed", rect(400, 400, 80, 80));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      // Label renders above the shape's own (unmoved during a resize) top
      // edge: (geometry.x, geometry.y - 16) = (400, 384). Same
      // mid-gesture-vs-settled comparison as the drag test above, for the
      // same reason (avoids any before/after confound).
      const labelRegion = { x: box.x + 400, y: box.y + 384, width: 80, height: 14 };

      await page.mouse.click(box.x + 440, box.y + 440); // select -> Transformer
      await page.waitForTimeout(150);

      const handleX = box.x + 480; // right-middle resize handle
      const handleY = box.y + 440;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 40, handleY, { steps: 10 });
      const midGesture = await sampleRegion(page, labelRegion.x, labelRegion.y, labelRegion.width, labelRegion.height);

      await page.mouse.up();
      await page.waitForTimeout(200);
      const afterRelease = await sampleRegion(page, labelRegion.x, labelRegion.y, labelRegion.width, labelRegion.height);
      expect(
        regionsDiffer(midGesture, afterRelease),
        "no visible difference between mid-resize and after-release at the label's position - either it never appeared, or never disappeared",
      ).toBe(true);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("dragging a polygon bed's vertex shows live neighbor-distance labels mid-gesture", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Live Label Polygon Bed", {
      type: "polygon",
      points: [
        { x: 700, y: 400 },
        { x: 800, y: 400 },
        { x: 800, y: 500 },
        { x: 700, y: 500 },
      ],
    });

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      // Distance labels render at the midpoint between the dragged vertex
      // and each neighbor - check the midpoint toward the (800,400)
      // neighbor, roughly (750,400)-ish once the vertex has moved.
      const labelRegion = { x: box.x + 720, y: box.y + 385, width: 60, height: 14 };
      const baseline = await sampleRegion(page, labelRegion.x, labelRegion.y, labelRegion.width, labelRegion.height);

      await page.mouse.click(box.x + 750, box.y + 450); // select the polygon bed
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      const vx = box.x + 700;
      const vy = box.y + 400;
      await page.mouse.move(vx, vy);
      await page.mouse.down();
      await page.mouse.move(vx + 10, vy - 40, { steps: 10 });
      const midGesture = await sampleRegion(page, labelRegion.x, labelRegion.y, labelRegion.width, labelRegion.height);
      expect(regionsDiffer(baseline, midGesture), "no neighbor-distance label appeared while the vertex drag was held").toBe(
        true,
      );

      await page.mouse.up();
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
