import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #249 ("Different heights for periods in
 * timeline view") - the implementer's own outcome comment explicitly could
 * not verify this visually (no seeded plantings in the local dev backend at
 * implementation time) and asked the tester to confirm the 1/2/4-period-type
 * cases per the ticket's own "How to test" steps. `BAR_HEIGHT_PX` (fixed at
 * 20px, rendered as `max(4, 20-4)=16px` tall) and the row-height floor/grow
 * behavior (`Math.max(ROW_HEIGHT_PX=40, laneTypes.length * BAR_HEIGHT_PX)`)
 * live entirely inside `TimelineView.tsx` component logic - not pure
 * functions extractable to a Vitest unit test - so this needs a real
 * browser measuring real rendered pixel geometry.
 *
 * Only 4 `period_type` codes are seeded in this app (`sowing`, `planting`,
 * `fertilizing`, `harvesting` - confirmed via a direct query), which
 * conveniently matches `MAX_LANES=4` exactly, letting this spec cover the
 * 1/2/4-lane cases with real, already-existing period types rather than
 * inventing new ones.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number; name: string }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createPlantWithPeriods(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  periodTypes: string[],
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
  for (const periodType of periodTypes) {
    const periodRes = await request.post(`/api/plants/${slug}/periods`, {
      data: { plant_slug: slug, period_type: periodType, start_month: 1, end_month: 2 },
    });
    expect(periodRes.ok(), `failed to create period "${periodType}": ${periodRes.status()} ${await periodRes.text()}`).toBeTruthy();
  }
}

async function createPlanting(request: APIRequestContext, bedId: number, plantSlug: string, plantedDate: string): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry: rect(0, 0, 40, 40), planted_date: plantedDate, removed_date: null },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Same FK-violation workaround `timeline-view.spec.ts` already documents
 * at length (#215) - a bed's own auto-generated `sow` Action can depend on
 * that same bed's `prepare_bed` Action, which a plain cascade delete 500s
 * on. */
async function deleteBed(request: APIRequestContext, bedId: number): Promise<void> {
  const actionsRes = await request.get("/api/actions").catch(() => null);
  if (actionsRes?.ok()) {
    const actions = (await actionsRes.json()) as { id: number; bed_id: number | null }[];
    for (const action of actions.filter((a) => a.bed_id === bedId)) {
      await request.patch(`/api/actions/${action.id}`, { data: { depends_on_action_id: null } }).catch(() => {});
    }
    for (const action of actions.filter((a) => a.bed_id === bedId)) {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  }
  await request.delete(`/api/beds/${bedId}?cascade=true`).catch(() => {});
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function gotoTimeline(page: Page): Promise<void> {
  await page.goto("/timeline");
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
}

/** Real rendered pixel geometry can differ by a couple of px from the exact
 * CSS value (subpixel layout/rounding) - a wider, explicit tolerance than
 * `toBeCloseTo`'s own precision-digit scheme reads more clearly for "close
 * enough to prove this wasn't computed some other way" assertions below. */
function expectCloseTo(actual: number, expected: number, tolerance = 3): void {
  expect(Math.abs(actual - expected), `expected ${actual} to be within ${tolerance} of ${expected}`).toBeLessThanOrEqual(tolerance);
}

function periodBar(page: Page, periodType: string, commonName: string) {
  return page.getByRole("button", { name: new RegExp(`${periodType}.*${commonName}`, "i") });
}

function cropRow(page: Page, commonName: string) {
  // The row-label button (from timeline-view.spec.ts's own established
  // pattern) is a direct child of the row's own grid container div - one
  // ".." hop reaches it.
  return page.getByRole("button").filter({ hasText: commonName }).locator("..");
}

const thisYear = new Date().getFullYear();

test.describe("Timeline period bar heights don't shrink per lane (#249)", () => {
  test("a single period type renders at the fixed bar height, in a default-height row", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-bar-height-1-${stamp}`;
    const commonName = `E2E BarHeight One ${stamp}`;
    const bed = await createBed(request, `E2E BarHeight One Bed ${stamp}`, rect(20, 20, 60, 60));
    await createPlantWithPeriods(request, slug, commonName, ["sowing"]);
    const planting = await createPlanting(request, bed.id, slug, `${thisYear}-01-10`);

    try {
      await gotoTimeline(page);

      const row = cropRow(page, commonName);
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      expect(rowBox, "row bounding box missing").not.toBeNull();
      expectCloseTo(rowBox!.height, 40); // ROW_HEIGHT_PX, default/floor

      const bar = periodBar(page, "sowing", commonName);
      await expect(bar).toBeVisible();
      const barBox = await bar.boundingBox();
      expect(barBox, "bar bounding box missing").not.toBeNull();
      expectCloseTo(barBox!.height, 16); // max(4, BAR_HEIGHT_PX(20) - 4)
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("two period types stack at the same fixed bar height within the default row height - neither bar shrinks", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-bar-height-2-${stamp}`;
    const commonName = `E2E BarHeight Two ${stamp}`;
    const bed = await createBed(request, `E2E BarHeight Two Bed ${stamp}`, rect(120, 20, 60, 60));
    await createPlantWithPeriods(request, slug, commonName, ["sowing", "harvesting"]);
    const planting = await createPlanting(request, bed.id, slug, `${thisYear}-01-10`);

    try {
      await gotoTimeline(page);

      const row = cropRow(page, commonName);
      const rowBox = await row.boundingBox();
      expectCloseTo(rowBox!.height, 40); // 2 lanes * 20 = 40, still the floor

      const sowingBar = periodBar(page, "sowing", commonName);
      const harvestingBar = periodBar(page, "harvesting", commonName);
      await expect(sowingBar).toBeVisible();
      await expect(harvestingBar).toBeVisible();
      const sowingBox = await sowingBar.boundingBox();
      const harvestingBox = await harvestingBar.boundingBox();

      // Same fixed height as the single-period-type case above - not
      // shrunk to fit 2 lanes into a smaller share of the row.
      expectCloseTo(sowingBox!.height, 16);
      expectCloseTo(harvestingBox!.height, 16);

      // Stacked in distinct lanes, not overlapping - roughly BAR_HEIGHT_PX
      // (20px) apart vertically.
      expectCloseTo(Math.abs(harvestingBox!.y - sowingBox!.y), 20);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("four period types (the max) grow the row taller instead of shrinking the bars further", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-bar-height-4-${stamp}`;
    const commonName = `E2E BarHeight Four ${stamp}`;
    const bed = await createBed(request, `E2E BarHeight Four Bed ${stamp}`, rect(220, 20, 60, 60));
    await createPlantWithPeriods(request, slug, commonName, ["sowing", "planting", "fertilizing", "harvesting"]);
    const planting = await createPlanting(request, bed.id, slug, `${thisYear}-01-10`);

    try {
      await gotoTimeline(page);

      const row = cropRow(page, commonName);
      const rowBox = await row.boundingBox();
      // 4 lanes * 20 = 80, taller than the 40px default/floor.
      expectCloseTo(rowBox!.height, 80);

      for (const periodType of ["sowing", "planting", "fertilizing", "harvesting"]) {
        const bar = periodBar(page, periodType, commonName);
        await expect(bar).toBeVisible();
        const box = await bar.boundingBox();
        // Still the same fixed bar height as the 1- and 2-lane cases -
        // the row grew instead of the bars shrinking.
        expectCloseTo(box!.height, 16);
      }
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("a taller (4-lane) row's own month columns stay aligned with the header and with a normal-height row's columns", async ({ page, request }) => {
    const stamp = Date.now();
    const shortSlug = `e2e-bar-align-short-${stamp}`;
    const shortName = `E2E BarAlign Short ${stamp}`;
    const tallSlug = `e2e-bar-align-tall-${stamp}`;
    const tallName = `E2E BarAlign Tall ${stamp}`;
    const bed = await createBed(request, `E2E BarAlign Bed ${stamp}`, rect(320, 20, 60, 60));
    // Both plants get an identical Jan-Feb "sowing" period - if column
    // alignment holds, their sowing bars should share the same x/width
    // regardless of one row being 40px tall and the other 80px tall.
    await createPlantWithPeriods(request, shortSlug, shortName, ["sowing"]);
    await createPlantWithPeriods(request, tallSlug, tallName, ["sowing", "planting", "fertilizing", "harvesting"]);
    const shortPlanting = await createPlanting(request, bed.id, shortSlug, `${thisYear}-01-10`);
    const tallPlanting = await createPlanting(request, bed.id, tallSlug, `${thisYear}-01-10`);

    try {
      await gotoTimeline(page);

      const shortRow = cropRow(page, shortName);
      const tallRow = cropRow(page, tallName);
      await expect(shortRow).toBeVisible();
      await expect(tallRow).toBeVisible();
      expectCloseTo((await shortRow.boundingBox())!.height, 40);
      expectCloseTo((await tallRow.boundingBox())!.height, 80);

      const shortSowingBar = periodBar(page, "sowing", shortName);
      const tallSowingBar = periodBar(page, "sowing", tallName);
      const shortBox = await shortSowingBar.boundingBox();
      const tallBox = await tallSowingBar.boundingBox();

      expectCloseTo(shortBox!.x, tallBox!.x);
      expectCloseTo(shortBox!.width, tallBox!.width);
    } finally {
      await request.delete(`/api/plantings/${shortPlanting.id}`).catch(() => {});
      await request.delete(`/api/plantings/${tallPlanting.id}`).catch(() => {});
      await request.delete(`/api/plants/${shortSlug}`).catch(() => {});
      await request.delete(`/api/plants/${tallSlug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });
});
