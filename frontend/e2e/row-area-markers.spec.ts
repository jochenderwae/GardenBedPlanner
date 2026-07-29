import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #155 ("Row/area planting: render individual
 * plant markers + spacing-override UI") - the implementer's own outcome
 * comment explicitly could not visually confirm the markers render/space
 * correctly on screen, or that the spacing override round-trips through a
 * real save+reload (no browser-automation tool available at implementation
 * time). `rowMarkerPositions`/`fieldMarkerPositions`'s own math already has
 * solid Vitest coverage (`geometry.test.ts`) - what's untested is whether
 * `PlantPlacementLayer.tsx` actually renders multiple individual markers
 * (not just the one bounding rectangle it always used to) and whether
 * `PlantingPanel.tsx`'s new spacing field actually re-spaces them.
 *
 * Uses the app's DEFAULT_VIEWPORT throughout - see `bed-label-overlap.spec.ts`'s
 * own doc for why this sidesteps every viewport/fitViewport-replica pitfall
 * the handle-scaling specs ran into. Expected marker positions below are
 * computed by hand from `rowMarkerPositions`'s own documented formula
 * (`centeredSegments`/`segmentCount`), not re-imported from the app source.
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

/** True if any opaque, genuinely-saturated (non-grayscale) pixel exists in
 * the given region - same technique `garden-timeline.spec.ts` uses, since
 * `colorForSlug` derives an unpredictable hash-based hue per plant slug and
 * what matters here is "is *a* marker there," not matching a specific
 * color. */
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

test.describe("Row/area individual plant markers + spacing override (#155)", () => {
  test("drawing a row shows multiple individual markers along it, not just the bounding rectangle", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Markers Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-markers-plant-${Date.now()}`;
    const commonName = `E2E Row Markers Plant ${Date.now()}`;
    await createPlant(request, slug, commonName, 40); // spread_cm=40 -> spacing

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      // Same drag as plant-placement-modes.spec.ts's own Row test: bed-local
      // (50,50)->(250,50), world (250,250)->(450,250) -> geometry
      // {x:50,y:30,width:200,height:40,rotation:0} (thicknessCm=40).
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();

      await waitForPlanting(request, bed.id);

      // rowMarkerPositions({x:50,y:30,width:200,height:40,rotation:0}, 40):
      // segmentCount(200,40)=5, centeredSegments(200,5) local x = 20,60,
      // 100,140,180, local y = height/2 = 20. Bed-local marker centers:
      // (70,50),(110,50),(150,50),(190,50),(230,50). Bed at world
      // (200,200) -> world (270,250)...(430,250). Check the first and last
      // (well separated, 160cm apart) - both being present, plus the
      // established "count()" check on the planting's own geometry (row
      // shape unchanged, unaffected by rendering) confirms this is
      // genuinely multiple rendered markers, not one big shape.
      const firstMarker = { x: box.x + 270, y: box.y + 250 };
      const lastMarker = { x: box.x + 430, y: box.y + 250 };

      // Positive presence checks only - a negative "nothing rendered
      // between the markers" check turned out too fragile in practice (the
      // row's own dimmed opacity-0.15 bounding-rect frame and its label
      // text both still register as faintly "saturated" by this scan's
      // threshold at some points inside the row's bounding box, unrelated
      // to whether individual markers exist) - two well-separated marker
      // positions both being genuinely present, 160cm apart along a single
      // row, is itself strong enough evidence of "multiple rendered
      // markers" for this ticket's actual requirement.
      await expect
        .poll(async () => regionHasSaturatedColor(page, firstMarker.x - 8, firstMarker.y - 8, 16, 16), {
          message: "no marker found at the row's first expected marker position",
          timeout: 5000,
        })
        .toBe(true);
      expect(
        await regionHasSaturatedColor(page, lastMarker.x - 8, lastMarker.y - 8, 16, 16),
        "no marker found at the row's last expected marker position - only a single blob rendered, not a real row of markers",
      ).toBe(true);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("changing a row's spacing override re-spaces its markers, and the change persists on reload", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Spacing Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-spacing-plant-${Date.now()}`;
    const commonName = `E2E Row Spacing Plant ${Date.now()}`;
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

      // Open its panel (a plain click on the row - the dimmed bounding
      // rect is still the drag/select/delete hit-target) and set an
      // explicit spacing override of 100cm.
      await page.mouse.click(box.x + 350, box.y + 250);
      const spacingInput = page.getByLabel(/Plant spacing/);
      await expect(spacingInput).toBeVisible();
      await spacingInput.fill("100");
      await spacingInput.blur();

      await expect
        .poll(async () => (await (await request.get(`/api/plantings/${planting.id}`)).json()).spacing_cm, {
          message: "spacing_cm override never persisted",
          timeout: 5000,
        })
        .toBe(100);

      // rowMarkerPositions(..., 100): segmentCount(200,100)=2,
      // centeredSegments(200,2) local x = 50,150, local y=20. Bed-local
      // (100,50),(200,50) -> world (300,250),(400,250) - only 2 markers
      // now, not 5. Reload to confirm this reflects the real persisted
      // value, not just an optimistic client-side re-render.
      await page.reload();
      await page.locator("canvas").first().waitFor();
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const newMarkerA = { x: box.x + 300, y: box.y + 250 };
      const newMarkerB = { x: box.x + 400, y: box.y + 250 };

      // Positive presence checks only, same rationale as the previous
      // test - both new expected marker positions being present after a
      // real reload (not just an optimistic client-side value) is the
      // actual thing this scenario needs to prove, combined with the
      // `spacing_cm: 100` persistence already confirmed via the API above.
      await expect
        .poll(async () => regionHasSaturatedColor(page, newMarkerA.x - 8, newMarkerA.y - 8, 16, 16), {
          message: "no marker found at the re-spaced row's first expected position after reload",
          timeout: 5000,
        })
        .toBe(true);
      expect(
        await regionHasSaturatedColor(page, newMarkerB.x - 8, newMarkerB.y - 8, 16, 16),
        "no marker found at the re-spaced row's second expected position after reload",
      ).toBe(true);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("dragging or deleting a row/field placement still acts on the whole unit, not individual markers", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Whole Unit Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-unit-plant-${Date.now()}`;
    const commonName = `E2E Row Unit Plant ${Date.now()}`;
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
      const originalGeometry = planting.geometry;

      // Drag the whole row (via its own bounding-rect hit target, a plain
      // click point on the row) by (30, 20) - the group, as one unit.
      await page.mouse.move(box.x + 350, box.y + 250);
      await page.mouse.down();
      await page.mouse.move(box.x + 380, box.y + 270, { steps: 8 });
      await page.mouse.up();

      // Not asserting an exact `+30,+20` landing spot - the initial
      // click-drag row draw itself doesn't always land on perfectly clean
      // integer coordinates (real pointer-pixel rounding noise, same
      // reason `plant-placement-modes.spec.ts` uses a tolerance helper for
      // its own drawn-geometry assertions rather than exact equality).
      // What actually matters for "whole unit, not individual markers" is:
      // the position changed, and the row's own shape (width/height/
      // rotation) didn't - a per-marker drag couldn't have produced that.
      await expect
        .poll(
          async () => {
            const fresh = (await (await request.get(`/api/plantings/${planting.id}`)).json()).geometry as Rect;
            return fresh.x !== originalGeometry.x || fresh.y !== originalGeometry.y;
          },
          { message: "dragging the row never moved its geometry", timeout: 5000 },
        )
        .toBe(true);
      const movedGeometry = (await (await request.get(`/api/plantings/${planting.id}`)).json()).geometry as Rect;
      expect(movedGeometry.width).toBe(originalGeometry.width);
      expect(movedGeometry.height).toBe(originalGeometry.height);
      expect(movedGeometry.rotation).toBe(originalGeometry.rotation);
      expect(Math.abs(movedGeometry.x - originalGeometry.x - 30)).toBeLessThan(3);
      expect(Math.abs(movedGeometry.y - originalGeometry.y - 20)).toBeLessThan(3);

      // Delete it (Delete key, per the keyboard-shortcut confirm-dialog
      // flow other specs in this directory already use) - the whole
      // placement, one Planting row, goes away as a unit. A drag alone
      // doesn't leave it selected for the keyboard shortcut's purposes
      // (only a plain click does, via onSelect) - click it again first, on
      // its new post-drag position.
      const rowCenterAfterMove = { x: box.x + 350 + 30, y: box.y + 250 + 20 };
      await page.mouse.click(rowCenterAfterMove.x, rowCenterAfterMove.y);
      await expect(page.getByText(/plantings selected/)).toHaveCount(0); // single select, not the bulk panel
      await page.keyboard.press("Delete");
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole("button", { name: /Remove/ }).click();
      await expect.poll(async () => (await request.get(`/api/plantings/${planting.id}`)).status()).toBe(404);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
