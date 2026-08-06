import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #247 ("Fix back buttons") - the implementer's
 * own outcome comment verified `useNavigateBack` only via two throwaway,
 * uncommitted Playwright checks. Covers all 3 wired call sites
 * (`TechnicalDrawing.tsx`, `PlantDetail.tsx`, `TaskDetail.tsx`), each with
 * both branches the hook itself distinguishes: a direct load with no real
 * in-app history entry (falls back to the hardcoded destination) and a real
 * in-app navigation (returns to the actual page the user came from via
 * `navigate(-1)`, not the fallback). For `PlantDetail`/`TaskDetail` the real
 * predecessor is reached through `/timeline` specifically (not `/plants`/
 * `/agenda`) so the two branches are genuinely distinguishable by URL, not
 * coincidentally identical.
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
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
  const periodRes = await request.post(`/api/plants/${slug}/periods`, {
    data: { plant_slug: slug, period_type: periodType, start_month: startMonth, end_month: endMonth },
  });
  expect(periodRes.ok(), `failed to create period: ${periodRes.status()} ${await periodRes.text()}`).toBeTruthy();
}

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  plantedDate: string,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry: rect(0, 0, 40, 40), planted_date: plantedDate, removed_date: null },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Same #215 FK-cascade workaround `timeline-view.spec.ts` already
 * documents at length - a bed's own `sow` Action can depend on that same
 * bed's `prepare_bed` Action, which trips a raw FK violation on a plain
 * cascade delete unless dependents are nulled out first. */
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

test.describe("Back button: real history vs. hardcoded fallback (#247)", () => {
  test("TechnicalDrawing: a direct load with no in-app history falls back to /layout", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Nav TechDrawing Bed ${stamp}`, rect(40, 40, 100, 100));

    try {
      await page.goto(`/layout/beds/${bed.id}/technical-drawing`);
      await expect(page.getByRole("heading", { name: "Technical drawing" })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/layout$/);
    } finally {
      await deleteBed(request, bed.id);
    }
  });

  test("TechnicalDrawing: real in-app navigation from BedPanel's own link returns via real history to /layout", async ({
    page,
    request,
  }) => {
    const bedName = `E2E Nav TechDrawing Nav Bed ${Date.now()}`;
    const bed = await createBed(request, bedName, rect(40, 40, 200, 150));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Objects" }).click();
      const canvasBox = await page.locator("canvas").first().boundingBox();
      if (!canvasBox) throw new Error("canvas not visible");
      await page.mouse.click(canvasBox.x + 90, canvasBox.y + 70);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      await page.getByRole("link", { name: "View technical drawing" }).click();
      await expect(page).toHaveURL(new RegExp(`/layout/beds/${bed.id}/technical-drawing$`));

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/layout$/);
    } finally {
      await deleteBed(request, bed.id);
    }
  });

  test("PlantDetail: a direct load with no in-app history falls back to /plants", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-back-plant-direct-${stamp}`;
    await request.post("/api/plants", { data: { slug, common_name: `E2E Nav Plant Direct ${stamp}`, botanical_name: "Testus e2eus" } });

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/plants$/);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("PlantDetail: real in-app navigation from Timeline's own 'View plant details' link returns to /timeline, not the /plants fallback", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-back-plant-timeline-${stamp}`;
    const commonName = `E2E Nav Plant Timeline ${stamp}`;
    const bed = await createBed(request, `E2E Nav Plant Timeline Bed ${stamp}`, rect(20, 20, 60, 60));
    await createPlantWithPeriod(request, slug, commonName, "harvesting", 3, 5);
    const planting = await createPlanting(request, bed.id, slug, `${new Date().getFullYear()}-01-10`);

    try {
      await gotoTimeline(page);
      const rowButton = page.getByRole("button").filter({ hasText: commonName });
      await expect(rowButton).toBeVisible();
      await rowButton.click();

      const plantLink = page.getByRole("link", { name: "View plant details" });
      await expect(plantLink).toBeVisible();
      await plantLink.click();
      await expect(page).toHaveURL(new RegExp(`/plants/${slug}$`));

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/timeline$/);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("TaskDetail: a direct load with no in-app history falls back to /agenda", async ({ page, request }) => {
    const res = await request.post("/api/actions", {
      data: { action_type: "prepare_bed", status: "pending", due_date_start: null, due_date_end: null },
    });
    const action = await res.json();

    try {
      await page.goto(`/tasks/${action.id}`);
      await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/agenda$/);
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("TaskDetail: real in-app navigation from Timeline's own 'View task details' link returns to /timeline, not the /agenda fallback", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-back-task-timeline-${stamp}`;
    const commonName = `E2E Nav Task Timeline ${stamp}`;
    const bed = await createBed(request, `E2E Nav Task Timeline Bed ${stamp}`, rect(20, 20, 60, 60));
    await createPlantWithPeriod(request, slug, commonName, "harvesting", 3, 5);
    const planting = await createPlanting(request, bed.id, slug, `${new Date().getFullYear()}-01-10`);

    try {
      await gotoTimeline(page);
      const diamond = page.getByRole("button", { name: /^Harvest/ });
      await expect(diamond).toBeVisible();
      await diamond.click();

      const taskLink = page.getByRole("link", { name: "View task details" });
      await expect(taskLink).toBeVisible();
      const href = await taskLink.getAttribute("href");
      await taskLink.click();
      await expect(page).toHaveURL(href!);

      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/timeline$/);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });
});
