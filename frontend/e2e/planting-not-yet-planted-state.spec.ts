import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #201 ("Render a distinct 'not yet planted'
 * state for future-dated plantings on the Edit tab"). The pure
 * `isPlantingVisibleOnEditTab`/`plantingStartVisualState`/
 * `describePlantingSchedule` logic already has solid Vitest coverage from
 * the implementer (`plantingLifecycle.test.ts`) - what's untested is
 * whether `Layout.tsx`/`PlantPlacementLayer.tsx`/`PlantingPanel.tsx`
 * actually wire that logic through to something a user can see.
 *
 * Worth calling out explicitly: the implementer's own outcome comment
 * corrects the ticket's premise - before this fix, a future-`planted_date`
 * planting was *entirely absent* from the Edit tab canvas (hidden until
 * its start date arrived), not rendered identically to an active one. So
 * the single most load-bearing thing to verify here is presence/
 * clickability of a future-dated planting's marker at all, not just its
 * dashed/faded styling - a regression back to the old behavior would make
 * the marker silently vanish again, which none of the pure-logic unit
 * tests can catch (they never render anything).
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

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  geometry: Rect,
  plantedDate: string | null,
  removedDate: string | null,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: {
      bed_id: bedId,
      plant_slug: plantSlug,
      placement_type: "individual",
      geometry,
      planted_date: plantedDate,
      removed_date: removedDate,
    },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
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

// Mirrors plantingLifecycle.ts's own todayIsoDate/addDaysToIsoDate exactly
// (local calendar date, UTC-midnight arithmetic) so this test's notion of
// "N days from now" always agrees with what the app itself computes,
// regardless of what time of day the suite happens to run.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe("Not-yet-planted state on the Edit tab (#201)", () => {
  test("a future planted_date well past the threshold stays visible and clickable, with a 'not yet planted' schedule line", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Not-Yet-Planted Bed", rect(200, 200, 200, 200));
    const slug = `e2e-not-yet-planted-${Date.now()}`;
    const commonName = "E2E Not Yet Planted Plant";
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    const futureDate = addDaysIso(todayIso(), 30); // well past the 14-day "starting soon" threshold
    const planting = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40), futureDate, null);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 260, box.y + 260); // world (260,260) = bed(200,200) + local(60,60), marker center

      // The marker is there and clickable at all - the actual bug this
      // ticket fixed (a future-dated planting used to be entirely absent).
      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();
      await expect(page.getByText(`Scheduled to start in 30 days`, { exact: true })).toBeVisible();
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a planted_date within the threshold shows a more imminent schedule line, still visible", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Starting Soon Bed", rect(200, 200, 200, 200));
    const slug = `e2e-starting-soon-${Date.now()}`;
    const commonName = "E2E Starting Soon Plant";
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    const soonDate = addDaysIso(todayIso(), 7); // within the 14-day threshold
    const planting = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40), soonDate, null);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 260, box.y + 260);

      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();
      await expect(page.getByText(`Scheduled to start in 7 days`, { exact: true })).toBeVisible();
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a planted_date of today (or unset) renders as an ordinary active planting with no schedule line", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Ordinary Planting Bed", rect(200, 200, 200, 200));
    const slug = `e2e-ordinary-planting-${Date.now()}`;
    const todayCommonName = "E2E Planted Today Plant";
    const unsetCommonName = "E2E Unset Date Plant";
    await request.post("/api/plants", { data: { slug, common_name: todayCommonName, botanical_name: "Testus e2eus" } });
    const slugUnset = `e2e-ordinary-unset-${Date.now()}`;
    await request.post("/api/plants", { data: { slug: slugUnset, common_name: unsetCommonName, botanical_name: "Testus e2eus" } });

    const plantingToday = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40), todayIso(), null);
    const plantingUnset = await createPlanting(request, bed.id, slugUnset, rect(140, 40, 40, 40), null, null);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);

      await page.mouse.click(box.x + 260, box.y + 260); // planted today
      await expect(page.getByRole("heading", { name: todayCommonName })).toBeVisible();
      await expect(page.getByText(/^Scheduled to start/)).toHaveCount(0);
      await page.getByRole("button", { name: "Close" }).click();

      await page.mouse.click(box.x + 360, box.y + 260); // planted_date unset
      await expect(page.getByRole("heading", { name: unsetCommonName })).toBeVisible();
      await expect(page.getByText(/^Scheduled to start/)).toHaveCount(0);
    } finally {
      for (const p of [plantingToday, plantingUnset]) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/plants/${slugUnset}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a planting whose removed_date has already passed stays absent from the Edit tab canvas, unaffected by planted_date", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Already Gone Bed", rect(200, 200, 200, 200));
    const slug = `e2e-already-gone-${Date.now()}`;
    const commonName = "E2E Already Gone Plant";
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    const pastPlanted = addDaysIso(todayIso(), -60);
    const pastRemoved = addDaysIso(todayIso(), -1); // removed yesterday
    const planting = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40), pastPlanted, pastRemoved);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 260, box.y + 260); // where the marker would be if it were still rendered

      // Nothing opens - the planting's own panel never appears, confirming
      // isPlantingVisibleOnEditTab still correctly excludes it.
      await expect(page.getByRole("heading", { name: commonName })).toHaveCount(0);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a planting with a past planted_date and a future (leaving-soon) removed_date shows #180's clearing schedule, not this ticket's starting schedule (point 4: mutually exclusive)", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Mutually Exclusive Bed", rect(200, 200, 200, 200));
    const slug = `e2e-mutually-exclusive-${Date.now()}`;
    const commonName = "E2E Mutually Exclusive Plant";
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    const pastPlanted = addDaysIso(todayIso(), -90);
    const soonRemoved = addDaysIso(todayIso(), 5); // within the leaving-soon threshold
    const planting = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40), pastPlanted, soonRemoved);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 260, box.y + 260);

      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();
      // Already in the ground (planted_date is in the past) - no "starting"
      // schedule line at all, only #180's "clearing" one.
      await expect(page.getByText(/^Scheduled to start/)).toHaveCount(0);
      await expect(page.getByText("Scheduled to be cleared in 5 days", { exact: true })).toBeVisible();
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
