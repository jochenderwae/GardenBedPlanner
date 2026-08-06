import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #125 ("Plant details page needs tooltips").
 * The ticket's own technical analysis describes native `title=`
 * attributes, but that mechanism was since superseded by #145's
 * `FieldHint`/`Tooltip` (Base UI) component - confirmed by reading the
 * current source of `fields.ts`/`FieldInput.tsx`/`LifeCycleFields.tsx`/
 * `SatelliteSections.tsx` directly (27 `FieldHint` usages across those
 * four files, feeding 28 scalar fields plus every satellite section's own
 * headings/columns/add-forms) rather than trusting the ticket body's
 * now-outdated description of the mechanism. The implementer's own
 * outcome comment explicitly flagged the interactive gap: "No
 * interactive/visual verification was done - no browser automation
 * available in this environment, so actually hovering each field to
 * confirm tooltip text still needs manual/tester-role verification."
 *
 * Reuses the same `hoverEveryFieldHint` technique
 * `field-hint-tooltip-coverage.spec.ts` (#80) established, applied here
 * to a data-rich plant so every satellite section's own FieldHint
 * triggers (which only render once at least one row/section is present
 * for some of them) actually mount.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** Hovers every FieldHint tooltip trigger found within `scope`, in order,
 * confirming each one opens a real, non-trivially-short tooltip - moving
 * the mouse well away between each so the previous tooltip actually
 * closes before the next hover. Same helper as
 * field-hint-tooltip-coverage.spec.ts (#80) - kept as its own local copy
 * rather than a shared import, since these e2e specs don't currently
 * share a support module and duplicating one small helper is simpler
 * than introducing one for a single reuse. */
async function hoverEveryFieldHint(page: Page, scope: Locator): Promise<string[]> {
  const triggers = scope.locator("[data-base-ui-tooltip-trigger]");
  const count = await triggers.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const trigger = triggers.nth(i);
    await trigger.hover();
    const openPopup = page.locator(".max-w-64[data-open]");
    await expect(openPopup).toBeVisible();
    const text = (await openPopup.textContent())?.trim() ?? "";
    expect(text.length, `FieldHint trigger #${i}'s tooltip text was suspiciously short/empty: "${text}"`).toBeGreaterThan(8);
    texts.push(text);
    await page.mouse.move(0, 0);
    await expect(openPopup).toHaveCount(0);
  }
  return texts;
}

test.describe("Plant detail page FieldHint tooltip coverage (#125)", () => {
  test("every labeled field across the scalar fields and every satellite section has a real, non-empty hover tooltip", async ({
    page,
    request,
  }) => {
    // 50+ individual FieldHint triggers, each hovered/verified/moved-away
    // from in turn - legitimately slower than the default 30s test
    // timeout even with nothing wrong.
    test.setTimeout(90000);
    const slug = `e2e-plant-tooltip-${Date.now()}`;
    const companionSlug = `e2e-plant-tooltip-companion-${Date.now()}`;
    const commonName = "E2E Tooltip Coverage Plant";
    await createPlant(request, slug, commonName);
    await createPlant(request, companionSlug, "E2E Tooltip Coverage Companion");

    // Populate every satellite table with at least one row, so every
    // per-row/per-section FieldHint trigger actually mounts, not just the
    // always-present "add new" form fields.
    await request.post(`/api/plants/${slug}/data-sources`, {
      data: { source_url: "https://example.com", attribution: "E2E source", notes: null },
    });
    await request.put(`/api/plants/${slug}/seed-info`, {
      data: { seeds_per_gram: 10, pretreatment: "soak overnight", produces_viable_seeds: true, is_f1_hybrid: false },
    });
    await request.post(`/api/plants/${slug}/periods`, {
      data: { period_type: "harvesting", start_month: 6, end_month: 8 },
    });
    await request.post(`/api/plants/${slug}/bedding-needs`, {
      data: { need_type: "hilling", notes: null },
    });
    await request.post(`/api/plants/${slug}/pest-interactions`, {
      data: { interaction_type: "attracts", pest_or_insect: "ladybugs", notes: null },
    });
    await request.post(`/api/plants/${slug}/companions`, {
      data: { companion_plant_slug: companionSlug, relationship: "good", mechanism: null, notes: null },
    });
    await request.post(`/api/plants/${slug}/growing-information`, {
      data: { text: "E2E growing information text.", source_url: null, attribution: null, record_type: "consolidated" },
    });

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();
      // #237 round 2 moved the secondary-tier scalar fields and every
      // satellite section behind this disclosure - most of the 50+ hints
      // this test counts live there now.
      await page.getByRole("button", { name: "Show more details" }).click();

      // Scoped to <main> (AppShell's own content region) rather than the
      // whole page, so this doesn't accidentally pick up an unrelated
      // tooltip trigger from the app shell/nav if one exists there.
      const main = page.locator("main");
      const texts = await hoverEveryFieldHint(page, main);

      // 28 scalar fields + 2 life-cycle fields + every satellite section's
      // own heading/column/add-form hints (confirmed via source: 22
      // FieldHint usages in SatelliteSections.tsx) - a real regression
      // guard against a future field losing its hint silently, not just
      // "some tooltips exist somewhere".
      expect(texts.length).toBeGreaterThanOrEqual(50);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/plants/${companionSlug}`).catch(() => {});
    }
  });
});
