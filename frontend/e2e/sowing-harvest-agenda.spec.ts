import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #29 ("Calendar view of planting-derived
 * actions") - `AgendaView.tsx`/`agendaMonths.ts`'s sowing/harvest windows
 * calendar. Not to be confused with `TaskAgendaView.tsx` (#181/#192's
 * Action-based task agenda) - both render on the same `/agenda` page
 * under separate headings ("Tasks" and "Sowing & harvest windows"), and
 * `task-agenda-view.spec.ts` only ever exercises the former. This is the
 * first e2e coverage of `AgendaView` itself - the implementer's own
 * outcome comment explicitly flagged "the actual rendered calendar is
 * left for the tester role to confirm... no browser automation available
 * in this environment" at the time it was written.
 *
 * The underlying `buildAgendaEntries`/`monthsInPeriod`/`groupByMonth`
 * pure logic already has solid Vitest coverage (`agendaMonths.test.ts`,
 * 10 tests) - what's untested is whether `AgendaView.tsx` actually wires
 * the real API data (plantings, beds, period types, per-plant periods)
 * through to something rendered, on both the desktop `/agenda` route and
 * the mobile route set's own Agenda tab.
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

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  geometry: Rect,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry, planted_date: null, removed_date: null },
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

test.describe("Sowing/harvest agenda (#29)", () => {
  test("an active planting's harvest window shows up on the desktop /agenda route, and dropping its removed_date to the past removes it", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Agenda Bed", rect(40, 40, 100, 100));
    const slug = `e2e-agenda-plant-${Date.now()}`;
    const commonName = "E2E Agenda Harvest Plant";
    await createPlant(request, slug, commonName);
    // Covers every month (1-12) - guarantees an entry shows up under
    // whichever real-world month this test happens to run in, without the
    // test needing to know or care what "today" actually is.
    const period = await createPeriod(request, slug, "harvesting", 1, 12);
    const planting = await createPlanting(request, bed.id, slug, rect(20, 20, 30, 30));

    try {
      await page.goto("/agenda");
      await expect(page.getByRole("heading", { name: "Sowing & harvest windows" })).toBeVisible();

      // "<plant> — <period label> (<bed name>)" per AgendaView's own render.
      // The period covers all 12 months, so it legitimately shows up under
      // every single month card - .first() is enough to confirm presence.
      const entryText = page.getByText(new RegExp(`${commonName}.*harvesting.*E2E Agenda Bed`, "i")).first();
      await expect(entryText).toBeVisible();

      // --- "windows update correctly if a planting's dates change" ---
      // Setting removed_date to yesterday makes the planting inactive as
      // of today - isPlantingActiveAsOf (shared with the Edit tab/#180)
      // excludes it from the agenda entirely, same as any other consumer.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const patchRes = await request.patch(`/api/plantings/${planting.id}`, { data: { removed_date: yesterday } });
      expect(patchRes.ok()).toBeTruthy();

      await page.reload();
      await expect(page.getByRole("heading", { name: "Sowing & harvest windows" })).toBeVisible();
      await expect(page.getByText(new RegExp(`${commonName}.*harvesting`, "i"))).toHaveCount(0);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test.describe("mobile viewport", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the same window shows up on the mobile route set's Agenda tab", async ({ page, request }) => {
      const bed = await createBed(request, "E2E Mobile Agenda Bed", rect(40, 40, 100, 100));
      const slug = `e2e-mobile-agenda-plant-${Date.now()}`;
      const commonName = "E2E Mobile Agenda Fertilizing Plant";
      await createPlant(request, slug, commonName);
      // Deliberately not "sowing" - a plant with a sowing-period plus a
      // planting on this bed auto-generates dependent sow/prepare_bed
      // Actions (#192's task-generation engine), which this test's own
      // `cascade=true` bed-delete cleanup then can't clean up due to a
      // real, already-filed, separate bug (#215 - cascade delete 500s
      // instead of cleanly cascading when a bed's own sow Action depends
      // on that same bed's own prepare_bed Action). Using "fertilizing"
      // here sidesteps that known bug entirely rather than leaking test
      // beds/actions into garden_test on every run until #215 is fixed -
      // this test is about the agenda rendering, not about #215's own
      // scope, so there's nothing lost by picking a period type that
      // doesn't trigger it.
      const period = await createPeriod(request, slug, "fertilizing", 1, 12);
      const planting = await createPlanting(request, bed.id, slug, rect(20, 20, 30, 30));

      try {
        await page.goto("/agenda");
        await dismissOnboardingIfPresent(page);
        await expect(
          page.getByText(new RegExp(`${commonName}.*fertilizing.*E2E Mobile Agenda Bed`, "i")).first(),
        ).toBeVisible();
      } finally {
        await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
        await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
        await request.delete(`/api/plants/${slug}`).catch(() => {});
        await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
      }
    });
  });
});
