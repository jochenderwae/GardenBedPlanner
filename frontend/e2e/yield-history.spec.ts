import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #222 ("Yield history / past-season productivity
 * review view"). `yieldHistory.ts`'s pure `buildYieldHistory` aggregation
 * already has solid Vitest coverage (the implementer's own outcome comment
 * cites 12 new unit tests) - what's untested is the page itself: does it
 * actually reach real harvest-log data through the API, group it into
 * cards/years the way the pure function says it should, and render the
 * per-year unit-total / no-amount-recorded / most-recent-first-entries
 * copy correctly. The implementer's own verification was a manual,
 * uncommitted Playwright run.
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

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createPlanting(request: APIRequestContext, bedId: number, plantSlug: string): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry: rect(40, 40, 40, 40), planted_date: null, removed_date: null },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createHarvestLog(
  request: APIRequestContext,
  plantingId: number,
  overrides: Record<string, unknown>,
): Promise<{ id: number }> {
  const res = await request.post("/api/harvest-logs", {
    data: { planting_id: plantingId, harvest_date: "2026-06-01", yield_amount: null, yield_unit: null, quality: null, notes: "", ...overrides },
  });
  expect(res.ok(), `failed to create harvest log: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

function cardSection(page: Page, exactTitle: string) {
  const title = page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${exactTitle}$`) });
  return page.locator('[data-slot="card"]').filter({ has: title });
}

test.describe("Yield history (#222)", () => {
  test("is reachable from the hamburger menu", async ({ page }) => {
    await page.goto("/");
    await dismissOnboardingIfPresent(page);
    await page.getByRole("button", { name: "Open menu" }).click();

    const navLink = page.getByRole("link", { name: "Yield history" });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/yield-history$/);
    await expect(page.getByRole("heading", { name: "Yield history" })).toBeVisible();
  });

  test("groups a plant's harvests by year, sums each year's amounts per distinct unit, and lists entries most-recent-first", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-yield-tomato-${stamp}`;
    const commonName = `E2E Yield Tomato ${stamp}`;
    const bed = await createBed(request, `E2E Yield Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, commonName);
    const plantingA = await createPlanting(request, bed.id, slug);
    const plantingB = await createPlanting(request, bed.id, slug);

    // 2025: two harvests on the same unit (kg) from two different
    // plantings of the same plant - should sum to one 2025 kg total. Whole
    // numbers deliberately - floating-point addition of e.g. 3.2 + 1.8
    // isn't guaranteed to render as exactly "5" in JS, and this assertion
    // cares about the summed *total*, not float-precision edge cases.
    const log1 = await createHarvestLog(request, plantingA.id, { harvest_date: "2025-07-10", yield_amount: 3, yield_unit: "kg", quality: "good" });
    const log2 = await createHarvestLog(request, plantingB.id, { harvest_date: "2025-08-15", yield_amount: 2, yield_unit: "kg", notes: "second flush" });
    // 2026: a differently-unitted harvest (count) - kept as its own
    // separate total, not summed into the kg figure.
    const log3 = await createHarvestLog(request, plantingA.id, { harvest_date: "2026-06-01", yield_amount: 12, yield_unit: "count" });
    // 2026: a harvest logged with no amount at all - contributes to the
    // "harvests logged" count but not to any unit total.
    const log4 = await createHarvestLog(request, plantingA.id, { harvest_date: "2026-06-20", quality: "excellent" });

    try {
      await page.goto("/yield-history");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Yield history" })).toBeVisible();

      const plantCard = cardSection(page, commonName);
      await expect(plantCard).toBeVisible();

      // 2025: summed kg total across both plantings' logs, "2 harvests".
      await expect(plantCard.getByText("2025")).toBeVisible();
      await expect(plantCard.getByText(/5 kg.*2 harvests/)).toBeVisible();

      // 2026: two entries, one with a real "count" total, one with no
      // amount at all - the year's own unit-total line only reflects the
      // amount-bearing entry, while the entry list itself still shows both
      // (2 harvests, not 1).
      await expect(plantCard.getByText("2026")).toBeVisible();
      await expect(plantCard.getByText(/12 count.*2 harvests/)).toBeVisible();

      // Quality label and notes surfaced per-entry.
      await expect(plantCard.getByText("Good")).toBeVisible();
      await expect(plantCard.getByText('"second flush"')).toBeVisible();
      await expect(plantCard.getByText("Excellent")).toBeVisible();

      // Most-recent-first within 2026: Jun 20 (log4, no amount) should
      // appear before Jun 1 (log3, 12 count) in document order.
      const entryTexts = await plantCard.locator("li").allTextContents();
      const idx20 = entryTexts.findIndex((t) => t.includes("Jun 20"));
      const idx1 = entryTexts.findIndex((t) => t.includes("Jun 1") && !t.includes("Jun 1,"));
      expect(idx20).toBeGreaterThanOrEqual(0);
      expect(idx1).toBeGreaterThanOrEqual(0);
      expect(idx20).toBeLessThan(idx1);
    } finally {
      for (const log of [log1, log2, log3, log4]) await request.delete(`/api/harvest-logs/${log.id}`).catch(() => {});
      await request.delete(`/api/plantings/${plantingA.id}`).catch(() => {});
      await request.delete(`/api/plantings/${plantingB.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("two different plants render as separate cards, sorted alphabetically by common name", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Yield Multi Bed ${stamp}`, rect(200, 200, 200, 200));
    const slugZ = `e2e-yield-zucchini-${stamp}`;
    const slugA = `e2e-yield-apple-${stamp}`;
    // Deliberately created Z-plant first, A-plant second - the page's own
    // sort must be alphabetical by common name, not creation order.
    await createPlant(request, slugZ, `E2E Yield Zzz-Squash ${stamp}`);
    await createPlant(request, slugA, `E2E Yield Aaa-Apple ${stamp}`);
    const plantingZ = await createPlanting(request, bed.id, slugZ);
    const plantingA = await createPlanting(request, bed.id, slugA);
    const logZ = await createHarvestLog(request, plantingZ.id, { yield_amount: 2, yield_unit: "kg" });
    const logA = await createHarvestLog(request, plantingA.id, { yield_amount: 5, yield_unit: "count" });

    try {
      await page.goto("/yield-history");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Yield history" })).toBeVisible();

      const cardTitles = page.locator('[data-slot="card-title"]');
      const zIndex = await cardTitles.filter({ hasText: `E2E Yield Zzz-Squash ${stamp}` }).first().elementHandle();
      const aIndex = await cardTitles.filter({ hasText: `E2E Yield Aaa-Apple ${stamp}` }).first().elementHandle();
      expect(zIndex, "Zzz-Squash card never rendered").not.toBeNull();
      expect(aIndex, "Aaa-Apple card never rendered").not.toBeNull();

      const allTitles = await cardTitles.allTextContents();
      const zPos = allTitles.findIndex((t) => t.includes(`E2E Yield Zzz-Squash ${stamp}`));
      const aPos = allTitles.findIndex((t) => t.includes(`E2E Yield Aaa-Apple ${stamp}`));
      expect(aPos, "Aaa-Apple should sort before Zzz-Squash alphabetically").toBeLessThan(zPos);
    } finally {
      await request.delete(`/api/harvest-logs/${logZ.id}`).catch(() => {});
      await request.delete(`/api/harvest-logs/${logA.id}`).catch(() => {});
      await request.delete(`/api/plantings/${plantingZ.id}`).catch(() => {});
      await request.delete(`/api/plantings/${plantingA.id}`).catch(() => {});
      await request.delete(`/api/plants/${slugZ}`).catch(() => {});
      await request.delete(`/api/plants/${slugA}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
