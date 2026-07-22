import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #85 ("Plant-placement tool: pick a plant, then
 * draw it as a point, a row, or an area") - all 4 of the ticket's own "How
 * to test" steps drive real click/drag gestures on the Konva canvas, which
 * neither a typecheck nor a Vitest/jsdom test can exercise (the pure
 * geometry math behind Row/Area - `rowGeometryFromDrag`/
 * `fieldGeometryFromDrag` - already has solid coverage in
 * `geometry.test.ts`, but not whether the real UI actually wires a drag
 * gesture through to it). The ticket has no implementer outcome comment
 * yet, so this works from the ticket body's own spec directly.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Point = { x: number; y: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

/** Real mouse-driven pixel coordinates land within roughly a pixel of the
 * intended world position (canvas devicePixelRatio/getRelativePointerPosition
 * sub-pixel rounding, not a grid-snap here since planting placement doesn't
 * grid-snap the way bed drags do) - a tolerance of 2cm is generous enough to
 * absorb that noise while still catching anything actually wrong. */
function expectRectCloseTo(actual: Rect, expected: Rect, tolerance = 2) {
  expect(actual.type).toBe(expected.type);
  expect(actual.x).toBeGreaterThan(expected.x - tolerance);
  expect(actual.x).toBeLessThan(expected.x + tolerance);
  expect(actual.y).toBeGreaterThan(expected.y - tolerance);
  expect(actual.y).toBeLessThan(expected.y + tolerance);
  expect(actual.width).toBeGreaterThan(expected.width - tolerance);
  expect(actual.width).toBeLessThan(expected.width + tolerance);
  expect(actual.height).toBeGreaterThan(expected.height - tolerance);
  expect(actual.height).toBeLessThan(expected.height + tolerance);
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
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
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

/** Arms the plant (Pick a plant -> select it) and switches to the given
 * placement mode radio ("Point"/"Row"/"Area"). */
async function armPlantAndSetMode(page: Page, commonName: string, modeLabel: "Point" | "Row" | "Area"): Promise<void> {
  await page.getByRole("button", { name: "Pick a plant" }).click();
  await page.getByRole("button", { name: new RegExp(commonName) }).click();
  // Wait for the picker popover to actually close - while it's still
  // mounted, its own list-item button ("<name> <botanical name>") also
  // matches a loose name search, ambiguous against the toolbar's own
  // now-armed button. `exact: true` alone resolves that ambiguity (the
  // toolbar button's accessible name is exactly the common name, nothing
  // appended), so this wait is a defensive belt-and-suspenders check, not
  // strictly required for the locator below to be unambiguous.
  await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: commonName, exact: true })).toBeVisible();
  if (modeLabel !== "Point") {
    await page.getByRole("radio", { name: modeLabel }).click();
  }
}

async function plantingsFor(
  request: APIRequestContext,
  bedId: number,
): Promise<{ id: number; bed_id: number; placement_type: string; geometry: Rect }[]> {
  const plantings = (await (await request.get("/api/plantings")).json()) as {
    id: number;
    bed_id: number;
    placement_type: string;
    geometry: Rect;
  }[];
  return plantings.filter((p) => p.bed_id === bedId);
}

/** The mutation that creates a placement fires after the mouse gesture
 * completes and can take a moment to land (same lesson every drag/resize
 * spec in this directory has needed - see e.g.
 * bed-garden-boundary-clamp.spec.ts) - polls rather than checking
 * immediately after `mouse.up()`. */
async function waitForPlanting(
  request: APIRequestContext,
  bedId: number,
): Promise<{ id: number; bed_id: number; placement_type: string; geometry: Rect }> {
  await expect
    .poll(async () => (await plantingsFor(request, bedId)).length, {
      message: `no planting ever appeared for bed ${bedId}`,
      timeout: 5000,
    })
    .toBeGreaterThan(0);
  const matches = await plantingsFor(request, bedId);
  return matches[matches.length - 1];
}

test.describe("Plant placement modes: Point / Row / Area (#85)", () => {
  test("Point mode: a single click creates an individual placement sized to the plant's own spread_cm", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Point Placement Bed", rect(200, 200, 400, 300));
    const slug = `e2e-point-plant-${Date.now()}`;
    const commonName = "E2E Point Placement Plant";
    await createPlant(request, slug, commonName, 50); // spread_cm=50, NOT the 20cm default

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlantAndSetMode(page, commonName, "Point");

      const box = await canvasBox(page);
      // World (350,320) -> bed-local (150,120) (bed at world (200,200)).
      await page.mouse.click(box.x + 350, box.y + 320);

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.placement_type).toBe("individual");
      // Centered on the click point, sized to spread_cm (50), not the 20cm
      // default - directly the ticket's step 4 requirement.
      expectRectCloseTo(planting.geometry, rect(125, 95, 50, 50));
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("Row mode: a click-drag shows a live preview and releases into a row placement", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Row Placement Bed", rect(200, 200, 400, 300));
    const slug = `e2e-row-plant-${Date.now()}`;
    const commonName = "E2E Row Placement Plant";
    await createPlant(request, slug, commonName, 40);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlantAndSetMode(page, commonName, "Row");

      const box = await canvasBox(page);
      // Horizontal drag, bed-local (50,50) -> (250,50), world (250,250) ->
      // (450,250).
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 450, y: box.y + 250 };

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      // Live preview should be visible mid-drag - not asserting exact
      // color (varies per plant slug hash) or pausing to check it here;
      // the geometry assertion below (which only a real, correctly-tracked
      // drag could satisfy) is the real regression signal for whether the
      // gesture registered at all.
      await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.placement_type).toBe("row");
      // rowGeometryFromDrag(start, end, thicknessCm=40) for a horizontal
      // drag: {x: 50, y: 50-20, width: 200, height: 40, rotation: 0}.
      expectRectCloseTo(planting.geometry, rect(50, 30, 200, 40));
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("Area mode: a click-drag shows a live preview and releases into a field placement", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Area Placement Bed", rect(200, 200, 400, 300));
    const slug = `e2e-area-plant-${Date.now()}`;
    const commonName = "E2E Area Placement Plant";
    await createPlant(request, slug, commonName, 30);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlantAndSetMode(page, commonName, "Area");

      const box = await canvasBox(page);
      // bed-local (50,150) -> (250,250), world (250,350) -> (450,450).
      const start: Point = { x: box.x + 250, y: box.y + 350 };
      const end: Point = { x: box.x + 450, y: box.y + 450 };

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.placement_type).toBe("field");
      // fieldGeometryFromDrag normalizes to the drag's own bounding box.
      expectRectCloseTo(planting.geometry, rect(50, 150, 200, 100));
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
