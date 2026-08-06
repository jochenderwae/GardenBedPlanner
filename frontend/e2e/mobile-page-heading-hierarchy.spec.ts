import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #148 ("Mobile route set's page-heading pattern
 * is inconsistent with itself and with desktop") - the implementer's own
 * outcome comment explicitly flagged "no visual/interactive verification
 * possible in this environment... flagging per usual for a human/tester
 * pass on an actual phone-width viewport across all 5 mobile routes."
 *
 * The design spec's actual, checkable criterion: "the mobile page title
 * should be visually >= the section headings beneath it" - measured here
 * as real computed `font-size` in px, not by trusting Tailwind class names
 * (which can be overridden per call site, and in fact are - AgendaView's
 * own month CardTitle and SeedGuideView's own per-plant CardTitle both
 * override CardTitle's 16px default down to a smaller size at their call
 * sites, confirmed by reading the source directly rather than assumed
 * from the ticket body's own class-name-level description).
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

test.describe("Mobile page-heading hierarchy (#148)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // `/` and `/logging` have since moved off the CardTitle-wrapped page
  // title this spec originally checked, onto a real semantic `<h1>` (a
  // strict accessibility improvement, found while re-running this spec -
  // `/`'s MobileHome now renders "Home" as its own `<h1>` per #224's
  // shipped mobile-home redesign; `/logging` followed the same pattern).
  // `/notifications` hasn't been migrated yet and still uses CardTitle -
  // real, current mixed state, not a mistake to paper over.
  const SIMPLE_ROUTES: Array<[string, string, "card-title" | "h1"]> = [
    ["/", "Home", "h1"],
    ["/logging", "Logging", "h1"],
    ["/notifications", "Notifications", "card-title"],
  ];

  for (const [path, titleText, kind] of SIMPLE_ROUTES) {
    test(`${path}: the page's own title renders at a real, non-trivial font size`, async ({ page }) => {
      await page.goto(path);
      const title =
        kind === "h1"
          ? page.locator("h1", { hasText: titleText }).first()
          : page.locator('[data-slot="card-title"]', { hasText: titleText }).first();
      await expect(title).toBeVisible();
      const size = await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      // 16px is CardTitle's own default (text-base) - a real regression
      // (e.g. an accidental text-xs/text-sm override) would show up as
      // meaningfully smaller than this.
      expect(size).toBeGreaterThanOrEqual(15);
    });
  }

  test("/agenda: the page's own <h1> renders >= AgendaView's own section CardTitle font size", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Mobile Heading Bed", rect(40, 40, 100, 100));
    const slug = `e2e-mobile-heading-plant-${Date.now()}`;
    const commonName = "E2E Mobile Heading Plant";
    await createPlant(request, slug, commonName);
    // "fertilizing", not "sowing" - a sowing-period planting auto-generates
    // a dependent sow/prepare_bed Action pair that then makes this test's
    // own cascade=true bed-delete cleanup 500 (see #215, a real
    // already-filed bug found while testing #29) - irrelevant to what
    // this test is actually about, so sidestepped entirely.
    const period = await createPeriod(request, slug, "fertilizing", 1, 12);
    const plantingRes = await request.post("/api/plantings", {
      data: { bed_id: bed.id, plant_slug: slug, placement_type: "individual", geometry: rect(10, 10, 20, 20), planted_date: null, removed_date: null },
    });
    expect(plantingRes.ok()).toBeTruthy();
    const planting = await plantingRes.json();

    try {
      await page.goto("/agenda");
      const h1 = page.locator("h1", { hasText: "Agenda" });
      await expect(h1).toBeVisible();

      // #29 replaced AgendaView's month Card/CardTitle with a real
      // Month/Week/Day/List Calendar - the day-cell CardTitle this test
      // originally measured against only renders in List mode now (Month
      // is the new default), and reads as a full weekday/month/day/year
      // date heading (taskAgenda.ts's formatDueDateHeading), not a bare
      // month name. Per #29's own implementer outcome comment's flagged
      // follow-up for this spec.
      await page.getByRole("radio", { name: "List" }).click();
      const sectionCardTitle = page
        .locator('[data-slot="card-title"]')
        .filter({ hasText: /^\w+day, \w+ \d{1,2}, \d{4}$/ })
        .first();
      await expect(sectionCardTitle).toBeVisible();

      const h1Size = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const sectionSize = await sectionCardTitle.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(
        h1Size,
        `page title (${h1Size}px) should read as visually >= the section heading beneath it (${sectionSize}px)`,
      ).toBeGreaterThanOrEqual(sectionSize);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("/seed-guide: the page's own <h1> renders >= SeedGuideView's own section CardTitle font size", async ({
    page,
    request,
  }) => {
    const slug = `e2e-mobile-seedguide-heading-plant-${Date.now()}`;
    const commonName = "E2E Mobile Seedguide Heading Plant";
    await createPlant(request, slug, commonName);
    // buildSeedGuideEntries only ever treats period_type "sowing" as
    // relevant (see seedGuide.ts's own SOWING_PERIOD_TYPE) - unlike the
    // /agenda test above, this never creates a Bed/Planting at all (the
    // seed guide is driven purely by SeedInventoryItem + Plant.periods),
    // so #215's cascade-delete trigger (which needs an actual Planting on
    // a Bed) never applies here regardless of period type.
    const period = await createPeriod(request, slug, "sowing", 1, 12);
    const itemRes = await request.post("/api/seed-inventory-items", {
      data: { plant_slug: slug, quantity_seeds: null, weight_grams: null },
    });
    expect(itemRes.ok(), `failed to create seed inventory item: ${itemRes.status()} ${await itemRes.text()}`).toBeTruthy();
    const item = await itemRes.json();

    try {
      await page.goto("/seed-guide");
      const h1 = page.locator("h1", { hasText: "Seed Guide" });
      await expect(h1).toBeVisible();

      const sectionCardTitle = page.locator('[data-slot="card-title"]', { hasText: commonName }).first();
      await expect(sectionCardTitle).toBeVisible();

      const h1Size = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const sectionSize = await sectionCardTitle.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(
        h1Size,
        `page title (${h1Size}px) should read as visually >= the section heading beneath it (${sectionSize}px)`,
      ).toBeGreaterThanOrEqual(sectionSize);
    } finally {
      await request.delete(`/api/seed-inventory-items/${item.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}/periods/${period.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
