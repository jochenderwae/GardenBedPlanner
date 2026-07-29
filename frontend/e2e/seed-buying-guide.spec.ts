import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #41 ("Seed buying guide / agenda-reminders
 * view") - the implementer's own outcome comment explicitly flagged this
 * gap: "No interactive/visual verification was done - no browser
 * automation available in this environment; the 'how to test' steps in
 * the issue (seeding low/high stock data and confirming buy/sow/absent
 * behavior) still need manual or tester-role verification against real
 * SeedInventoryItem data." The underlying `isSowingApproaching`/
 * `buildSeedGuideEntries` pure logic already has solid Vitest coverage
 * (`seedGuide.test.ts`) - what's untested is whether `SeedGuideView.tsx`
 * actually wires real API data through to something rendered.
 *
 * Drives all 3 of the ticket's own "How to test" steps against the
 * desktop `/seed-guide` route.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createPeriod(
  request: APIRequestContext,
  slug: string,
  periodType: string,
  startMonth: number,
  endMonth: number,
): Promise<{ id: number }> {
  const res = await request.post(`/api/plants/${slug}/periods`, {
    data: { period_type: periodType, start_month: startMonth, end_month: endMonth },
  });
  expect(res.ok(), `failed to create period: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createSeedItem(
  request: APIRequestContext,
  plantSlug: string,
  quantitySeeds: number | null,
): Promise<{ id: number }> {
  const res = await request.post("/api/seed-inventory-items", {
    data: { plant_slug: plantSlug, quantity_seeds: quantitySeeds, weight_grams: null },
  });
  expect(res.ok(), `failed to create seed inventory item: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

// Mirrors seedGuide.ts's own isSowingApproaching (referenceMonth or the
// very next one, 1-12 wrapping) - used here only to compute a month that's
// deliberately *neither* of those two, for the "not approaching" case,
// deterministically regardless of what real-world date this suite runs on.
function farAwayMonth(): number {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  return ((currentMonth + 5) % 12) + 1; // 6 months out either direction
}

test.describe("Seed buying guide (#41)", () => {
  test("a plant with an approaching sowing window and no stock shows as 'Buy soon'", async ({ page, request }) => {
    const slug = `e2e-seedguide-buy-${Date.now()}`;
    // Deliberately doesn't contain "Buy soon" itself - this test asserts
    // that exact badge text appears, so the plant's own name mustn't
    // accidentally supply it (a real self-inflicted collision hit while
    // writing this spec).
    const commonName = "E2E Guide Low Stock Plant";
    await createPlant(request, slug, commonName);
    const period = await createPeriod(request, slug, "sowing", 1, 12);
    const item = await createSeedItem(request, slug, 0);

    try {
      await page.goto("/seed-guide");
      await dismissOnboardingIfPresent(page);
      const row = page.locator('[data-slot="card-title"]', { hasText: commonName });
      await expect(row).toBeVisible();
      const urgencyBadge = page.getByText("Buy soon");
      await expect(urgencyBadge).toBeVisible();
    } finally {
      await request.delete(`/api/seed-inventory-items/${item.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant with an approaching sowing window and stock on hand shows as 'Sow soon', not 'Buy soon'", async ({
    page,
    request,
  }) => {
    const slug = `e2e-seedguide-sow-${Date.now()}`;
    const commonName = "E2E Guide Stocked Plant";
    await createPlant(request, slug, commonName);
    const period = await createPeriod(request, slug, "sowing", 1, 12);
    const item = await createSeedItem(request, slug, 20);

    try {
      await page.goto("/seed-guide");
      await dismissOnboardingIfPresent(page);
      const row = page.locator('[data-slot="card-title"]', { hasText: commonName });
      await expect(row).toBeVisible();
      await expect(page.getByText("Sow soon")).toBeVisible();
      await expect(page.getByText("Buy soon")).toHaveCount(0);
    } finally {
      await request.delete(`/api/seed-inventory-items/${item.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant whose sowing window is nowhere near approaching doesn't appear on the guide at all", async ({
    page,
    request,
  }) => {
    const slug = `e2e-seedguide-notdue-${Date.now()}`;
    const commonName = "E2E Not Due Plant";
    await createPlant(request, slug, commonName);
    const month = farAwayMonth();
    const period = await createPeriod(request, slug, "sowing", month, month);
    const item = await createSeedItem(request, slug, 0); // no stock, but urgency should be "ok" regardless

    try {
      await page.goto("/seed-guide");
      await dismissOnboardingIfPresent(page);
      await expect(page.locator('[data-slot="card-title"]', { hasText: commonName })).toHaveCount(0);
    } finally {
      await request.delete(`/api/seed-inventory-items/${item.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("the guide updates as stock changes - buying seeds moves an entry from 'Buy soon' to 'Sow soon'", async ({
    page,
    request,
  }) => {
    const slug = `e2e-seedguide-updates-${Date.now()}`;
    const commonName = "E2E Updates Live Plant";
    await createPlant(request, slug, commonName);
    const period = await createPeriod(request, slug, "sowing", 1, 12);
    const item = await createSeedItem(request, slug, 0);

    try {
      await page.goto("/seed-guide");
      await dismissOnboardingIfPresent(page);
      await expect(page.locator('[data-slot="card-title"]', { hasText: commonName })).toBeVisible();
      await expect(page.getByText("Buy soon")).toBeVisible();

      const patchRes = await request.patch(`/api/seed-inventory-items/${item.id}`, { data: { quantity_seeds: 15 } });
      expect(patchRes.ok()).toBeTruthy();

      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(page.locator('[data-slot="card-title"]', { hasText: commonName })).toBeVisible();
      await expect(page.getByText("Sow soon")).toBeVisible();
      await expect(page.getByText("Buy soon")).toHaveCount(0);
    } finally {
      await request.delete(`/api/seed-inventory-items/${item.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
