import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #261 ("Edit row and area plantings") - a placed
 * row/field planting can now be resized/rotated directly on the canvas via
 * Konva Transformer handles (PlantPlacementLayer.tsx's `PlantingMarker` row/
 * field branch), matching BedNode.tsx's existing bed-editing interaction.
 * The implementer's own outcome comment explicitly did NOT separately verify
 * the field/area case's independent width/height resize (only asserted it
 * "should behave identically" by code-path inspection) - that's the gap this
 * spec closes, plus repeatable coverage of the row case, the rotate handle,
 * persistence across reload, and the bed-boundary clamp.
 *
 * Uses the app's DEFAULT_VIEWPORT (no "Fit view" click) - same reasoning
 * `bed-label-overlap.spec.ts`/`bed-rotate-handle-drag.spec.ts` document:
 * world coordinates map directly onto canvas-local pixels (scale=1, no pan)
 * at initial load, so screen positions can be computed directly from known
 * world coordinates instead of replicating `fitViewport`'s zoom/pan math.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Point = { x: number; y: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createPlant(request: APIRequestContext, slug: string, commonName: string, spreadCm: number): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", spread_cm: spreadCm },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
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

async function armPlant(page: Page, commonName: string, modeLabel: "Row" | "Area"): Promise<void> {
  await page.getByRole("button", { name: "Pick a plant" }).click();
  await page.getByRole("button", { name: new RegExp(commonName) }).click();
  await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: commonName, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: modeLabel }).click();
}

async function plantingsFor(request: APIRequestContext, bedId: number): Promise<{ id: number; geometry: Rect }[]> {
  const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; bed_id: number; geometry: Rect }[];
  return plantings.filter((p) => p.bed_id === bedId);
}

async function waitForPlanting(request: APIRequestContext, bedId: number): Promise<{ id: number; geometry: Rect }> {
  await expect
    .poll(async () => (await plantingsFor(request, bedId)).length, { message: `no planting ever appeared for bed ${bedId}`, timeout: 5000 })
    .toBeGreaterThan(0);
  const matches = await plantingsFor(request, bedId);
  return matches[matches.length - 1];
}

async function fetchGeometry(request: APIRequestContext, plantingId: number): Promise<Rect> {
  const res = await request.get(`/api/plantings/${plantingId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).geometry as Rect;
}

/** Same saturated-color-region probe `row-area-markers.spec.ts` uses to
 * confirm an individual plant marker rendered at a given canvas position
 * (markers get an unpredictable hash-based hue, so this checks "is *a*
 * marker there," not a specific color). */
async function regionHasSaturatedColor(page: Page, cssX: number, cssY: number, width: number, height: number): Promise<boolean> {
  return page.evaluate(
    ({ cssX, cssY, width, height }) => {
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
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const localX = Math.round((cssX + dx - refBox.left) * scaleX);
          const localY = Math.round((cssY + dy - refBox.top) * scaleY);
          if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) continue;
          const [r, g, b, a] = sctx.getImageData(localX, localY, 1, 1).data;
          if (a < 200) continue;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          if (saturation > 40) return true;
        }
      }
      return false;
    },
    { cssX, cssY, width, height },
  );
}

const ROTATE_ANCHOR_OFFSET_PX = 50; // BedNode.tsx's TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX, reused by PlantPlacementLayer.tsx

test.describe("Row/field planting boundary editing via Transformer handles (#261)", () => {
  test("dragging a row's corner handle resizes it and live-updates its markers mid-gesture, persisting after reload", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Resize Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-resize-plant-${Date.now()}`;
    const commonName = `E2E Row Resize Plant ${Date.now()}`;
    await createPlant(request, slug, commonName, 40); // spread_cm=40 -> thicknessCm and marker spacing

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      // World (250,250)->(450,250): bed-local geometry {x:50,y:30,width:200,
      // height:40,rotation:0} (thicknessCm=40) -> world rect x=250,y=230,
      // width=200,height=40. Existing rightmost marker (segmentCount(200,40)
      // =5, centeredSegments last=180 local) sits at world (430,250).
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      const planting = await waitForPlanting(request, bed.id);

      // Select it (open its edit panel) - Transformer handles only render
      // while isEditing is true.
      await page.mouse.click(box.x + 350, box.y + 250);
      await expect(page.getByLabel(/Plant spacing/)).toBeVisible();

      // A new marker position that would appear only after a width increase
      // to ~300cm (segmentCount(300,40)=8, centeredSegments last local x =
      // 281.25) is not present yet.
      const farRightMarker = { x: box.x + 531, y: box.y + 250 };
      expect(await regionHasSaturatedColor(page, farRightMarker.x - 10, farRightMarker.y - 10, 20, 20)).toBe(false);

      // Drag the bottom-right corner handle (world 450,270) purely
      // horizontally (dy=0) so only width changes, not height/thickness.
      const handle: Point = { x: box.x + 450, y: box.y + 270 };
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(handle.x + 50, handle.y, { steps: 5 });
      await page.mouse.move(handle.x + 100, handle.y, { steps: 5 });

      // Still mid-gesture (no mouseup yet) - the new marker position should
      // already be live, per the ticket's own "live-update, not just after
      // release" requirement.
      await expect
        .poll(async () => regionHasSaturatedColor(page, farRightMarker.x - 10, farRightMarker.y - 10, 20, 20), {
          message: "row's new rightmost marker never appeared live during the resize gesture",
          timeout: 3000,
        })
        .toBe(true);

      await page.mouse.up();

      // Commits close to width=300, height unchanged at 40 (dy=0 kept
      // thickness fixed) - some grid-snap rounding tolerance.
      await expect
        .poll(async () => (await fetchGeometry(request, planting.id!)).width, {
          message: "row resize never persisted a wider geometry",
          timeout: 5000,
        })
        .toBeGreaterThan(280);
      const resized = await fetchGeometry(request, planting.id!);
      expect(resized.height).toBeCloseTo(40, -1);
      expect(resized.x).toBeCloseTo(50, -1); // unchanged - only the opposite (right) edge moved

      // Persists across a real reload, not just an optimistic client value.
      await page.reload();
      await page.locator("canvas").first().waitFor();
      await page.getByRole("tab", { name: "Plants" }).click();
      const afterReload = await fetchGeometry(request, planting.id!);
      expect(afterReload).toEqual(resized);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("dragging a row's rotation handle rotates it, and the change persists after reload", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Rotate Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-rotate-plant-${Date.now()}`;
    const commonName = `E2E Row Rotate Plant ${Date.now()}`;
    await createPlant(request, slug, commonName, 40);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      const planting = await waitForPlanting(request, bed.id);

      await page.mouse.click(box.x + 350, box.y + 250);
      await expect(page.getByLabel(/Plant spacing/)).toBeVisible();

      // Rotate handle sits ROTATE_ANCHOR_OFFSET_PX above the boundary's own
      // top-center (world 350, 230) - i.e. world (350, 180).
      const handleX = box.x + 350;
      const handleY = box.y + 230 - ROTATE_ANCHOR_OFFSET_PX;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 60, handleY + 20, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => (await fetchGeometry(request, planting.id!)).rotation, {
          message: "rotate-handle drag never persisted a rotation change",
          timeout: 5000,
        })
        .not.toBe(0);
      const rotated = await fetchGeometry(request, planting.id!);

      await page.reload();
      await page.locator("canvas").first().waitFor();
      await page.getByRole("tab", { name: "Plants" }).click();
      const afterReload = await fetchGeometry(request, planting.id!);
      expect(afterReload.rotation).toBeCloseTo(rotated.rotation, 5);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a field placement's width and height resize independently via separate edge handles", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Field Independent Resize Bed", rect(200, 200, 400, 300));
    const slug = `e2e-field-resize-plant-${Date.now()}`;
    const commonName = `E2E Field Resize Plant ${Date.now()}`;
    await createPlant(request, slug, commonName, 20);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Area");

      const box = await canvasBox(page);
      // World (250,250)->(450,450) -> bed-local {x:50,y:50,width:200,
      // height:200,rotation:0} -> world rect x=250,y=250,width=200,height=200.
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 450 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      const planting = await waitForPlanting(request, bed.id);
      const original = await fetchGeometry(request, planting.id!);
      // Field placement draws don't grid-snap their initial position (only
      // Transformer resize/rotate commits do, per handleTransformEnd) - same
      // pixel-rounding tolerance `row-area-markers.spec.ts` notes for its own
      // drawn-geometry assertions.
      expect(original.type).toBe("rectangle");
      expect(Math.abs(original.x - 50)).toBeLessThan(2);
      expect(Math.abs(original.y - 50)).toBeLessThan(2);
      expect(Math.abs(original.width - 200)).toBeLessThan(2);
      expect(Math.abs(original.height - 200)).toBeLessThan(2);
      expect(original.rotation).toBe(0);

      await page.mouse.click(box.x + 350, box.y + 350);
      await expect(page.getByLabel(/Plant spacing/)).toBeVisible();

      // Right-middle edge anchor at world (450, 350) - drag purely
      // horizontally to grow width only, height untouched.
      const rightMiddle: Point = { x: box.x + 450, y: box.y + 350 };
      await page.mouse.move(rightMiddle.x, rightMiddle.y);
      await page.mouse.down();
      await page.mouse.move(rightMiddle.x + 50, rightMiddle.y, { steps: 8 });
      await page.mouse.up();

      await expect
        .poll(async () => (await fetchGeometry(request, planting.id!)).width, {
          message: "field's right-edge handle never resized its width",
          timeout: 5000,
        })
        .toBeGreaterThan(210);
      const afterWidthResize = await fetchGeometry(request, planting.id!);
      expect(afterWidthResize.height).toBeCloseTo(200, -1);

      // Bottom-middle edge anchor, recomputed from the now-updated width -
      // world x = bed(200) + x(50) + width/2, world y = bed(200) + y(50) +
      // height(200).
      const bottomMiddleX = box.x + 200 + afterWidthResize.x + afterWidthResize.width / 2;
      const bottomMiddleY = box.y + 200 + afterWidthResize.y + afterWidthResize.height;
      await page.mouse.move(bottomMiddleX, bottomMiddleY);
      await page.mouse.down();
      await page.mouse.move(bottomMiddleX, bottomMiddleY + 50, { steps: 8 });
      await page.mouse.up();

      await expect
        .poll(async () => (await fetchGeometry(request, planting.id!)).height, {
          message: "field's bottom-edge handle never resized its height",
          timeout: 5000,
        })
        .toBeGreaterThan(210);
      const afterHeightResize = await fetchGeometry(request, planting.id!);
      // Width from the first (independent) resize is untouched by the
      // second (height-only) gesture - proves the two axes are genuinely
      // independent, not coupled/keepRatio.
      expect(afterHeightResize.width).toBeCloseTo(afterWidthResize.width, -1);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("resizing a row far past its bed's edge clamps it to stay inside the bed rather than escaping it", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Clamp Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-clamp-plant-${Date.now()}`;
    const commonName = `E2E Row Clamp Plant ${Date.now()}`;
    await createPlant(request, slug, commonName, 40);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      const planting = await waitForPlanting(request, bed.id);

      await page.mouse.click(box.x + 350, box.y + 250);
      await expect(page.getByLabel(/Plant spacing/)).toBeVisible();

      // Drag the bottom-right corner handle (world 450,270) far past the
      // bed's own right edge (bed spans bed-local x 0..400, world x
      // 200..600) - well beyond what the bed can actually contain.
      const handle: Point = { x: box.x + 450, y: box.y + 270 };
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(handle.x + 300, handle.y + 5, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(
          async () => {
            const geometry = await fetchGeometry(request, planting.id!);
            return geometry.width !== 200;
          },
          { message: "extreme resize drag never registered any geometry change", timeout: 5000 },
        )
        .toBe(true);

      const clamped = await fetchGeometry(request, planting.id!);
      // Bed-local footprint is (0,0)-(400,300) (the bed's own border_geometry
      // width/height passed to createBed above) - the resized/repositioned
      // row must stay fully inside it, not escape past the bed's own edge.
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.x + clamped.width).toBeLessThanOrEqual(400.001);
      expect(clamped.y).toBeGreaterThanOrEqual(0);
      expect(clamped.y + clamped.height).toBeLessThanOrEqual(300.001);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
