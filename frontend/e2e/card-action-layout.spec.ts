import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #248 ("Close button at an odd place"). The fix
 * (wrapping each header action element in the existing `CardAction`
 * component, since a plain sibling `<Button>` falls to `CardHeader`'s
 * second grid row - underneath the title - rather than beside it) touched
 * 3 call sites: `TimelineDetailPanel.tsx`'s close button, `GardenPlan.tsx`'s
 * delete-plan button, and `SeedGuideView.tsx`'s urgency badge. The
 * implementer's own outcome comment could only visually confirm the
 * `GardenPlan.tsx` case locally (no seeded plantings/actions or seed-
 * inventory data at implementation time to reach the other two) and
 * explicitly asked the tester to confirm all 3 once real data exists. This
 * verifies each one geometrically: the title and its action element render
 * on the same row (near-equal y, action strictly to the right of the
 * title), not stacked.
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

async function createPlantWithPeriod(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  periodType: string,
  startMonth: number,
  endMonth: number,
): Promise<void> {
  const res = await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
  const periodRes = await request.post(`/api/plants/${slug}/periods`, {
    data: { plant_slug: slug, period_type: periodType, start_month: startMonth, end_month: endMonth },
  });
  expect(periodRes.ok(), `failed to create period: ${periodRes.status()} ${await periodRes.text()}`).toBeTruthy();
}

async function createPlanting(request: APIRequestContext, bedId: number, plantSlug: string, plantedDate: string): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry: rect(0, 0, 40, 40), planted_date: plantedDate, removed_date: null },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

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

async function createSeedItem(request: APIRequestContext, plantSlug: string, quantitySeeds: number | null): Promise<{ id: number }> {
  const res = await request.post("/api/seed-inventory-items", { data: { plant_slug: plantSlug, quantity_seeds: quantitySeeds, weight_grams: null } });
  expect(res.ok(), `failed to create seed inventory item: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** Confirms `titleLocator` and `actionLocator` render on the same visual
 * row (near-equal vertical center, action strictly to the right of the
 * title) rather than the pre-#248 failure mode of the action element
 * falling to `CardHeader`'s own second grid row, underneath the title. */
async function expectSameRow(titleLocator: ReturnType<Page["locator"]>, actionLocator: ReturnType<Page["locator"]>): Promise<void> {
  const titleBox = await titleLocator.boundingBox();
  const actionBox = await actionLocator.boundingBox();
  expect(titleBox, "title element has no bounding box").not.toBeNull();
  expect(actionBox, "action element has no bounding box").not.toBeNull();
  const titleCenterY = titleBox!.y + titleBox!.height / 2;
  const actionCenterY = actionBox!.y + actionBox!.height / 2;
  expect(
    Math.abs(titleCenterY - actionCenterY),
    `title (y-center ${titleCenterY}) and action (y-center ${actionCenterY}) are not vertically aligned - the action likely fell to a second row underneath the title`,
  ).toBeLessThan(16);
  expect(actionBox!.x, "action element is not to the right of the title - expected a same-row layout").toBeGreaterThanOrEqual(titleBox!.x);
}

test.describe("CardHeader action sits beside its title, not underneath it (#248)", () => {
  test("TimelineDetailPanel's close button", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-cardaction-timeline-${stamp}`;
    const commonName = `E2E CardAction Timeline ${stamp}`;
    const bed = await createBed(request, `E2E CardAction Timeline Bed ${stamp}`, rect(20, 20, 60, 60));
    await createPlantWithPeriod(request, slug, commonName, "harvesting", 3, 5);
    const planting = await createPlanting(request, bed.id, slug, `${new Date().getFullYear()}-01-10`);

    try {
      await page.goto("/timeline");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const rowButton = page.getByRole("button").filter({ hasText: commonName });
      await expect(rowButton).toBeVisible();
      await rowButton.click();

      const panelTitle = page.locator('[data-slot="card-title"]', { hasText: commonName });
      await expect(panelTitle).toBeVisible();
      const closeButton = page.getByRole("button", { name: "Close" });
      await expect(closeButton).toBeVisible();

      await expectSameRow(panelTitle, closeButton);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("GardenPlan's delete-plan button", async ({ page, request }) => {
    const stamp = Date.now();
    const seasonName = `E2E CardAction Plan ${stamp}`;
    const planRes = await request.post("/api/garden-plans", { data: { season_name: seasonName, year: new Date().getFullYear(), notes: "" } });
    expect(planRes.ok(), `failed to create plan: ${planRes.status()}`).toBeTruthy();
    const plan = await planRes.json();

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);
      const planTitle = page.locator('[data-slot="card-title"]', { hasText: new RegExp(seasonName) });
      await expect(planTitle).toBeVisible();
      const deleteButton = page.getByRole("button", { name: "Delete plan" });
      await expect(deleteButton).toBeVisible();

      await expectSameRow(planTitle, deleteButton);
    } finally {
      await request.delete(`/api/garden-plans/${plan.id}?cascade=true`).catch(() => {});
    }
  });

  test("SeedGuideView's urgency badge", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-cardaction-seedguide-${stamp}`;
    const commonName = `E2E CardAction Seed Guide ${stamp}`;
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    // A sowing window spanning the whole year is always "approaching"
    // (isSowingApproaching's own referenceMonth-or-next check), and 0 seeds
    // on hand means "buy" urgency - guarantees this renders as an
    // actionable card regardless of what real-world date this runs on.
    await request.post(`/api/plants/${slug}/periods`, { data: { plant_slug: slug, period_type: "sowing", start_month: 1, end_month: 12 } });
    const item = await createSeedItem(request, slug, 0);

    try {
      await page.goto("/seed-guide");
      await dismissOnboardingIfPresent(page);
      const entryTitle = page.locator('[data-slot="card-title"]', { hasText: commonName });
      await expect(entryTitle).toBeVisible();
      const entryCard = page.locator('[data-slot="card"]').filter({ has: entryTitle });
      const urgencyBadge = entryCard.locator('[data-slot="card-action"]');
      await expect(urgencyBadge).toBeVisible();

      await expectSameRow(entryTitle, urgencyBadge);
    } finally {
      await request.delete(`/api/seed-inventory-items/${item.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
