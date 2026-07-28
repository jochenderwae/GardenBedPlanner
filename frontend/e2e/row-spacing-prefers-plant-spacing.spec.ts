import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #195 ("Prefer plant_spacing_cm over spread_cm
 * as row/area default spacing") - the implementer's own outcome comment
 * reports build/lint/vitest passing only (7 new tests for the pure
 * `defaultPlantSpacing`/`effectivePlantSpacing` helpers), no interactive
 * check that a real row-draw gesture actually resolves to the new default.
 * Complements `row-area-markers.spec.ts` (#155), whose own scenarios only
 * used plants with `spread_cm` set (no `plant_spacing_cm`) - this
 * specifically exercises a plant where the two values genuinely differ, to
 * prove the *preference order* itself, not just that spacing renders at
 * all. Uses the app's DEFAULT_VIEWPORT throughout, same reasoning as
 * `bed-label-overlap.spec.ts`'s own doc.
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

async function armPlant(page: Page, commonName: string): Promise<void> {
  await page.getByRole("button", { name: "Pick a plant" }).click();
  await page.getByRole("button", { name: new RegExp(commonName) }).click();
  await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: commonName, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Row" }).click();
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

test.describe("Row default spacing prefers plant_spacing_cm over spread_cm (#195)", () => {
  test("a plant with both set uses plant_spacing_cm, not spread_cm, as the default row spacing", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Spacing Preference Bed", rect(200, 200, 400, 300));
    const slug = `e2e-spacing-pref-plant-${Date.now()}`;
    const commonName = `E2E Spacing Pref Plant ${Date.now()}`;
    // Deliberately far apart: if spread_cm (100) were still used, a
    // 200cm-wide row would only fit 2 markers; at plant_spacing_cm (20) it
    // fits far more, so the two are trivially distinguishable by whether a
    // marker lands at the halfway point of the row.
    await request.post("/api/plants", {
      data: { slug, common_name: commonName, botanical_name: "Testus e2eus", spread_cm: 100, plant_spacing_cm: 20 },
    });

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName);

      const box = await canvasBox(page);
      // bed-local (50,50)->(250,50), world (250,250)->(450,250) - matches
      // plant-placement-modes.spec.ts's own Row test geometry
      // {x:50,y:30,width:200,height:40,rotation:0} (thicknessCm follows the
      // armed plant's effective spacing too, but that's not what's under
      // test here - only the row's own marker spacing is).
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.geometry.width).toBe(200);

      // At plant_spacing_cm=20: segmentCount(200,20)=10 markers, definitely
      // including one very close to the row's own midpoint (world x=350).
      // At spread_cm=100 (the wrong fallback): segmentCount(200,100)=2
      // markers, centered at world x≈300 and x≈400 - NEITHER anywhere near
      // x=350. So a marker actually present at the row's midpoint is
      // strong, simple positive evidence plant_spacing_cm won.
      const midpoint = { x: box.x + 350, y: box.y + 250 };
      await expect
        .poll(async () => regionHasSaturatedColor(page, midpoint.x - 8, midpoint.y - 8, 16, 16), {
          message: "no marker found at the row's midpoint - looks like spread_cm (100cm spacing) was used instead of plant_spacing_cm (20cm)",
          timeout: 5000,
        })
        .toBe(true);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("a plant with no plant_spacing_cm still falls back to spread_cm as before", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Spacing Fallback Bed", rect(200, 200, 400, 300));
    const slug = `e2e-spacing-fallback-plant-${Date.now()}`;
    const commonName = `E2E Spacing Fallback Plant ${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: commonName, botanical_name: "Testus e2eus", spread_cm: 40 },
    });

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName);

      const box = await canvasBox(page);
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      await waitForPlanting(request, bed.id);

      // rowMarkerPositions({x:50,y:30,width:200,height:40}, 40): 5 markers
      // at bed-local x=70,110,150,190,230 -> world 270,310,350,390,430 -
      // same as row-area-markers.spec.ts's own first scenario. Check the
      // first and last, well separated.
      const firstMarker = { x: box.x + 270, y: box.y + 250 };
      const lastMarker = { x: box.x + 430, y: box.y + 250 };
      await expect
        .poll(async () => regionHasSaturatedColor(page, firstMarker.x - 8, firstMarker.y - 8, 16, 16), {
          message: "no marker found at the spread_cm-fallback row's first expected position",
          timeout: 5000,
        })
        .toBe(true);
      expect(await regionHasSaturatedColor(page, lastMarker.x - 8, lastMarker.y - 8, 16, 16)).toBe(true);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
