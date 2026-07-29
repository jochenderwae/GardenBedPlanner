import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #182 ("The timeline view") - a substantial,
 * mostly-new Gantt-style visualization (`frontend/src/pages/timeline/*`)
 * with no prior test coverage beyond `timelineData.test.ts`'s pure-function
 * unit tests. The implementer's own outcome comment verified rendering via
 * an ad-hoc, uncommitted Playwright screenshot check - this is the real,
 * repeatable equivalent: crop rows (period bars + task diamonds), bed
 * swimlanes, the year selector, the Month/Week granularity toggle, and the
 * click-through detail panel with its "View details" links, all driven
 * through the real API + a real browser (jsdom/Vitest can't drive Konva-
 * adjacent CSS-grid layout interaction any more than it can drive Konva
 * itself).
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
  removedDate: string | null = null,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: {
      bed_id: bedId,
      plant_slug: plantSlug,
      placement_type: "individual",
      geometry: rect(0, 0, 40, 40),
      planted_date: plantedDate,
      removed_date: removedDate,
    },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createBedOnlyAction(
  request: APIRequestContext,
  bedId: number,
  actionType: string,
  dueDate: string,
): Promise<{ id: number }> {
  const res = await request.post("/api/actions", {
    data: { action_type: actionType, bed_id: bedId, status: "pending", due_date_start: dueDate, due_date_end: dueDate },
  });
  expect(res.ok(), `failed to create action: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** `DELETE /api/beds/{id}?cascade=true` alone isn't reliable cleanup here -
 * see #215 (filed while writing this spec): it 500s with a raw
 * `ForeignKeyViolation` whenever a bed's own auto-generated `sow` Action
 * depends on that same bed's own `prepare_bed` Action (any bed with a
 * `started_from_seed=true` planting whose plant has a `sowing` period -
 * exactly what `createPlantWithPeriod`/`createPlanting` below produce).
 * Nulls out every one of the bed's own actions' `depends_on_action_id`
 * first (a plain PATCH, not relying on the backend's own broken nulling
 * step), deletes them individually, then deletes the bed - the same
 * "sidestep the FK by clearing dependents before cascading" workaround
 * `bed-canvas-drag-pan.spec.ts` already uses for the same underlying class
 * of bug. Test-code workaround, not a fix to #215 - stays out of backend/'s
 * boundary. */
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

/** The detail panel's own `CardTitle` renders a plain `<div>` (shadcn's
 * `card.tsx`), not a semantic heading - `getByRole("heading")` never
 * matches it. Scope by the component's own `data-slot="card-title"`
 * instead of guessing at an ARIA role that isn't actually there. */
function detailPanelTitle(page: Page) {
  return page.locator('[data-slot="card-title"]');
}

/** Scopes a field-value lookup to inside the currently-open detail panel -
 * a bed/plant name routinely also appears elsewhere on the page at the same
 * time (the Gantt row's own label, a swimlane's label, another selection's
 * leftover DOM) so an unscoped `page.getByText(...)` is never safe here. */
function detailPanelContent(page: Page) {
  return page.locator('[data-slot="card-content"]');
}

/** The Year `<select>` - not `page.getByLabel("Year")`: a native `<select>`
 * implicitly labelled by wrapping it in `<label>Year<select>...` computes
 * its own accessible name by concatenating the label's *entire* text
 * content, which includes every rendered `<option>`'s own text too (a real,
 * if obscure, browser accessible-name quirk - confirmed empirically: the
 * select's actual accessible name came back as "Year20232026" while writing
 * this spec, not plain "Year"). Locating via the `<label>` wrapper instead
 * sidesteps that quirk entirely. */
function yearSelect(page: Page) {
  return page.locator("label", { hasText: "Year" }).locator("select");
}

const thisYear = new Date().getFullYear();

test.describe("Timeline view (#182)", () => {
  test("a planting's period bar and auto-generated task diamond render in its crop row; clicking each opens the matching detail panel with a working View-details link", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-timeline-crop-${stamp}`;
    const commonName = `E2E Timeline Crop ${stamp}`;
    const bed = await createBed(request, `E2E Timeline Bed ${stamp}`, rect(20, 20, 60, 60));
    await createPlantWithPeriod(request, slug, commonName, "harvesting", 3, 5);
    const planting = await createPlanting(request, bed.id, slug, `${thisYear}-01-10`);

    try {
      await gotoTimeline(page);

      // Row header (plant name + bed name) is present and its own click
      // opens the "planting" summary.
      const rowButton = page.getByRole("button").filter({ hasText: commonName });
      await expect(rowButton).toBeVisible();
      await rowButton.click();
      await expect(detailPanelTitle(page)).toHaveText(commonName);
      await expect(detailPanelContent(page).getByText(bed.name)).toBeVisible();
      await expect(page.getByRole("link", { name: "View plant details" })).toBeVisible();

      // Period bar (aria-label "harvesting — <commonName>") - click opens the
      // "period" summary with its own Type/Window fields.
      const periodBar = page.getByRole("button", { name: new RegExp(`harvesting.*${commonName}`, "i") });
      await expect(periodBar).toBeVisible();
      await periodBar.click();
      await expect(detailPanelTitle(page)).toHaveText(new RegExp(`harvesting.*${commonName}`, "i"));
      await expect(detailPanelContent(page).getByText(/Mar.*May/)).toBeVisible(); // Window field, "Mar – May"

      // Task diamond (#192 auto-generated a Harvest action from the
      // "harvesting" period on planting creation) - click opens the "task"
      // summary with a working "View task details" link through to
      // /tasks/{id} (#181's task detail page).
      const diamond = page.getByRole("button", { name: /^Harvest/ });
      await expect(diamond).toBeVisible();
      await diamond.click();
      await expect(detailPanelTitle(page)).toHaveText("Harvest");
      await expect(detailPanelContent(page).getByText("Pending")).toBeVisible();
      const taskLink = page.getByRole("link", { name: "View task details" });
      await expect(taskLink).toBeVisible();
      const href = await taskLink.getAttribute("href");
      expect(href).toMatch(/^\/tasks\/\d+$/);
      await taskLink.click();
      await expect(page).toHaveURL(href!);

      // Following the link away from /timeline didn't error out - confirm
      // the app rendered something real, not a blank/broken route.
      await expect(page.locator("body")).not.toBeEmpty();
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("a bed-only task renders as its own swimlane row below the crop rows, with a bed detail panel and a technical-drawing link", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Timeline Swimlane Bed ${stamp}`, rect(120, 20, 60, 60));
    // "compost", not "prepare_bed" - every bed already gets its own
    // auto-generated prepare_bed Action for free on creation (#192), so
    // using that same action_type here would produce two same-labelled
    // diamonds on the same swimlane row and make the locator below
    // ambiguous. A distinct action_type sidesteps that collision cleanly.
    const action = await createBedOnlyAction(request, bed.id, "compost", `${thisYear}-04-15`);

    try {
      await gotoTimeline(page);

      // "Bed tasks" appears twice - once as the swimlane section's own
      // header, once as the row label's subtitle span - .first() picks the
      // section header deliberately, not to paper over the duplication.
      await expect(page.getByText("Bed tasks").first()).toBeVisible();
      const swimlaneLabel = page.getByRole("button").filter({ hasText: bed.name });
      await expect(swimlaneLabel).toBeVisible();

      const diamond = page.getByRole("button", { name: /^Compost/ });
      await expect(diamond).toBeVisible();
      await diamond.click();
      await expect(detailPanelTitle(page)).toHaveText("Compost");
      await expect(detailPanelContent(page).getByText("Pending")).toBeVisible();

      // Clicking the swimlane's own bed-name label opens the "bed" summary
      // instead (a different selection type from the task diamond above).
      await swimlaneLabel.click();
      await expect(detailPanelTitle(page)).toHaveText(bed.name);
      await expect(page.getByRole("link", { name: "View technical drawing" })).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("the year selector switches which year's plantings show - a planting only appears in a crop row for the year(s) it actually overlaps", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const pastYear = thisYear - 3;
    const slug = `e2e-timeline-yr-${stamp}`;
    const commonName = `E2E Timeline Season Crop ${stamp}`;
    const bed = await createBed(request, `E2E Timeline Season Bed ${stamp}`, rect(20, 120, 60, 60));
    await createPlantWithPeriod(request, slug, commonName, "fertilizing", 6, 6);
    // A real removed_date, not left open-ended - `plantingOverlapsYear`
    // (timelineData.ts) correctly treats a *never*-removed planting as
    // still "in the ground" and therefore present in every later year too,
    // not just its own planted year (confirmed directly - an earlier
    // version of this test wrongly assumed a null removed_date meant
    // "only shows in its planted year," which isn't this feature's actual,
    // correct behavior). Bounding the planting to a single past year here
    // is what actually makes "gone once its own year isn't selected" true.
    const planting = await createPlanting(request, bed.id, slug, `${pastYear}-06-01`, `${pastYear}-09-01`);

    try {
      await gotoTimeline(page);

      const select = yearSelect(page);
      await expect(select).toBeVisible();
      // Default selection is the latest year (this year) - the past-year
      // planting must not show yet.
      await expect(page.getByRole("button").filter({ hasText: commonName })).toHaveCount(0);

      await select.selectOption(String(pastYear));
      await expect(page.getByRole("button").filter({ hasText: commonName })).toBeVisible();

      await select.selectOption(String(thisYear));
      await expect(page.getByRole("button").filter({ hasText: commonName })).toHaveCount(0);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });

  test("the Month/Week granularity toggle switches the header columns without losing the row's own content", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-timeline-granularity-${stamp}`;
    const commonName = `E2E Timeline Granularity Crop ${stamp}`;
    const bed = await createBed(request, `E2E Timeline Granularity Bed ${stamp}`, rect(120, 120, 60, 60));
    await createPlantWithPeriod(request, slug, commonName, "sowing", 2, 3);
    const planting = await createPlanting(request, bed.id, slug, `${thisYear}-01-10`);

    try {
      await gotoTimeline(page);

      const rowButton = page.getByRole("button").filter({ hasText: commonName });
      await expect(rowButton).toBeVisible();
      // Month granularity: 12 short month-name header columns.
      await expect(page.getByText("Jan", { exact: true })).toBeVisible();
      await expect(page.getByText("Dec", { exact: true })).toBeVisible();

      const weekToggle = page.getByRole("radio", { name: "Week" });
      await weekToggle.click();
      await expect(page.getByText("W1", { exact: true })).toBeVisible();
      // The row itself (and its plant-name label) survive the granularity
      // switch - this isn't a full remount that loses the selected year's
      // data.
      await expect(rowButton).toBeVisible();

      const monthToggle = page.getByRole("radio", { name: "Month" });
      await monthToggle.click();
      await expect(page.getByText("Jan", { exact: true })).toBeVisible();
      await expect(rowButton).toBeVisible();
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bed.id);
    }
  });
});
