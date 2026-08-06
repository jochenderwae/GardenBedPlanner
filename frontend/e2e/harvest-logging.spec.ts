import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #221 ("Harvest logging UI: amount/quality/notes,
 * partial-harvest flow tied to harvest tasks") - the shared HarvestLogDialog
 * component's pure resolution logic already has solid Vitest coverage
 * (`harvestPlanting.test.ts`), but the actual dialog/form/history-list
 * interaction only exists at the component level and needs a real browser.
 * The implementer's own outcome comment explicitly walked through most of
 * the ticket's own numbered "How to test" steps manually, but didn't mention
 * step 6 (the multi-match disabled case), step 7 (the empty-submit
 * validation guard), or step 8 (a submit failure keeping the dialog open
 * with values intact) - those three are this spec's main net-new coverage,
 * alongside repeatable coverage of the rest.
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

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: {
      bed_id: bedId,
      plant_slug: plantSlug,
      placement_type: "individual",
      geometry: rect(40, 40, 40, 40),
      planted_date: null,
      removed_date: null,
    },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createHarvestAction(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
): Promise<{ id: number }> {
  const res = await request.post("/api/actions", {
    data: { action_type: "harvest", status: "pending", bed_id: bedId, plant_slug: plantSlug },
  });
  expect(res.ok(), `failed to create harvest action: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function harvestLogsFor(request: APIRequestContext, plantingId: number) {
  const res = await request.get(`/api/harvest-logs?planting_id=${plantingId}`);
  if (res.ok()) return res.json();
  // Fall back to the unfiltered list + client-side filter if the query
  // param isn't actually supported server-side.
  const all = (await (await request.get("/api/harvest-logs")).json()) as { id: number; planting_id: number }[];
  return all.filter((l) => l.planting_id === plantingId);
}

test.describe("Harvest logging (#221)", () => {
  test("logging a harvest with 'More to come' creates a log and keeps the task pending; a later 'last harvest' log marks it done", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-harvest-strawberry-${stamp}`;
    const bed = await createBed(request, `E2E Harvest Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, `E2E Strawberry ${stamp}`);
    const planting = await createPlanting(request, bed.id, slug);
    const action = await createHarvestAction(request, bed.id, slug);

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("button", { name: "Log a harvest" })).toBeVisible();

      // --- Step 1: log with "More to come" (the default) ---
      await page.getByRole("button", { name: "Log a harvest" }).click();
      const dialog1 = page.getByRole("dialog");
      await dialog1.getByLabel("Amount").fill("2.5");
      await dialog1.getByLabel("Unit").fill("kg");
      await dialog1.getByRole("radio", { name: "Good" }).click();
      await dialog1.getByLabel("Notes").fill("smaller than usual this year");
      await expect(dialog1.getByRole("button", { name: "Log harvest", exact: true })).toBeVisible();
      await dialog1.getByRole("button", { name: "Log harvest", exact: true }).click();

      await expect
        .poll(async () => (await harvestLogsFor(request, planting.id)).length, {
          message: "first harvest log was never created",
        })
        .toBe(1);
      await expect(page.getByText(/2\.5 kg/)).toBeVisible();
      await expect(page.getByText(/"smaller than usual this year"/)).toBeVisible();

      // Task must still be pending - "More to come" doesn't touch the Action.
      const afterFirst = await (await request.get(`/api/actions/${action.id}`)).json();
      expect(afterFirst.status).toBe("pending");

      // --- Step 2: a second log, most-recent-first in the history list ---
      await page.getByRole("button", { name: "Log a harvest" }).click();
      const dialog2 = page.getByRole("dialog");
      await dialog2.getByLabel("Amount").fill("1.8");
      await dialog2.getByLabel("Unit").fill("kg");
      await dialog2.getByRole("button", { name: "Log harvest", exact: true }).click();

      await expect
        .poll(async () => (await harvestLogsFor(request, planting.id)).length, {
          message: "second harvest log was never created",
        })
        .toBe(2);

      // --- Step 3: "This is the last harvest" marks the task done ---
      await page.getByRole("button", { name: "Log a harvest" }).click();
      const dialog3 = page.getByRole("dialog");
      await dialog3.getByLabel("Amount").fill("0.5");
      await dialog3.getByLabel("Unit").fill("kg");
      await dialog3.getByRole("radio", { name: "This is the last harvest" }).click();
      await expect(dialog3.getByRole("button", { name: "Log harvest & mark task done" })).toBeVisible();
      await dialog3.getByRole("button", { name: "Log harvest & mark task done" }).click();

      await expect
        .poll(async () => (await harvestLogsFor(request, planting.id)).length, {
          message: "third harvest log was never created",
        })
        .toBe(3);
      await expect
        .poll(async () => (await (await request.get(`/api/actions/${action.id}`)).json()).status, {
          message: "task was never marked completed after the final harvest",
        })
        .toBe("completed");
      // The status row's own toggle button flips label once the task is
      // completed ("Mark pending" instead of "Mark complete") - a more
      // robust UI confirmation than matching "Completed" text directly,
      // which also (ambiguously) appears in a second "Completed: <date>"
      // dt/dd row once `action.completed_date` is set.
      await expect(page.getByRole("button", { name: "Mark pending" })).toBeVisible();

      // All three entries visible, most-recent-first (0.5 is the latest,
      // logged just now with today's date, same as the other two - so we
      // just confirm all three amounts are present in the history list).
      await expect(page.getByText(/2\.5 kg/)).toBeVisible();
      await expect(page.getByText(/1\.8 kg/)).toBeVisible();
      await expect(page.getByText(/0\.5 kg/)).toBeVisible();
    } finally {
      for (const log of await harvestLogsFor(request, planting.id)) {
        await request.delete(`/api/harvest-logs/${log.id}`).catch(() => {});
      }
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("the same HarvestLogDialog works from MobileLogging.tsx's flat task list", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-harvest-mobile-${stamp}`;
    const bed = await createBed(request, `E2E Harvest Mobile Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, `E2E Mobile Onion ${stamp}`);
    const planting = await createPlanting(request, bed.id, slug);
    const action = await createHarvestAction(request, bed.id, slug);

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/logging");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Logging" })).toBeVisible();

      const commonName = (await (await request.get(`/api/plants/${slug}`)).json()).common_name as string;
      // Two levels up: `text=commonName` resolves to the innermost <span>
      // holding just the plant name (per HarvestTaskRow's own markup, a
      // nested <span> sibling of the bed-name span) - its immediate parent
      // is only that text-pair wrapper, not the outer flex row that also
      // holds the "Log harvest" button as a separate sibling.
      const row = page.locator("text=" + commonName).locator("..").locator("..");
      // The row's own trigger button and the dialog's submit button share
      // the literal label "Log harvest" once open - scope the trigger click
      // to the row specifically to disambiguate.
      await row.getByRole("button", { name: "Log harvest" }).click();

      const dialog = page.getByRole("dialog");
      // "Amount" also exists on this same page's separate compost-log form
      // (MobileLogging.tsx renders both sections at once) - scope every
      // field lookup to the dialog itself, not the whole page.
      await dialog.getByLabel("Amount").fill("3");
      await dialog.getByLabel("Unit").fill("count");
      await dialog.getByRole("button", { name: "Log harvest", exact: true }).click();

      await expect
        .poll(async () => (await harvestLogsFor(request, planting.id)).length, {
          message: "mobile-entry-point harvest log was never created",
        })
        .toBe(1);
      const afterLog = await (await request.get(`/api/actions/${action.id}`)).json();
      expect(afterLog.status).toBe("pending"); // default "More to come"
    } finally {
      for (const log of await harvestLogsFor(request, planting.id)) {
        await request.delete(`/api/harvest-logs/${log.id}`).catch(() => {});
      }
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a harvest task whose planting has already been removed disables 'Log a harvest' with the zero-match message", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-harvest-removed-${stamp}`;
    const bed = await createBed(request, `E2E Harvest Removed Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, `E2E Removed Cucumber ${stamp}`);
    // No active planting created at all (matchCount 0) - simplest way to
    // reproduce the zero-match degrade state deterministically.
    const action = await createHarvestAction(request, bed.id, slug);

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      const trigger = page.getByRole("button", { name: "Log a harvest" });
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeDisabled();
      await expect(page.getByText(/already been cleared/)).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("two concurrent active plantings of the same plant in the same bed disables 'Log a harvest' with the multi-match message, not a silent guess", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-harvest-multi-${stamp}`;
    const bed = await createBed(request, `E2E Harvest Multi Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, `E2E Multi Basil ${stamp}`);
    const plantingA = await createPlanting(request, bed.id, slug);
    const plantingB = await createPlanting(request, bed.id, slug);
    const action = await createHarvestAction(request, bed.id, slug);

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      const trigger = page.getByRole("button", { name: "Log a harvest" });
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeDisabled();
      await expect(page.getByText(/Can't tell which planting/)).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await request.delete(`/api/plantings/${plantingA.id}`).catch(() => {});
      await request.delete(`/api/plantings/${plantingB.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("submitting with amount, quality, and notes all empty is blocked by inline validation, not a silent empty log row", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-harvest-empty-${stamp}`;
    const bed = await createBed(request, `E2E Harvest Empty Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, `E2E Empty Pear ${stamp}`);
    const planting = await createPlanting(request, bed.id, slug);
    const action = await createHarvestAction(request, bed.id, slug);

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      await page.getByRole("button", { name: "Log a harvest" }).click();
      // Leave amount/quality/notes all empty, submit anyway.
      await page.getByRole("button", { name: "Log harvest", exact: true }).click();

      await expect(page.getByText("Add at least an amount or a note.")).toBeVisible();
      // Dialog stays open (still showing the form's own submit button).
      await expect(page.getByRole("button", { name: "Log harvest", exact: true })).toBeVisible();
      // Nothing was created.
      expect((await harvestLogsFor(request, planting.id)).length).toBe(0);
    } finally {
      for (const log of await harvestLogsFor(request, planting.id)) {
        await request.delete(`/api/harvest-logs/${log.id}`).catch(() => {});
      }
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a failed submit keeps the dialog open with entered values intact and shows an inline error", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-harvest-fail-${stamp}`;
    const bed = await createBed(request, `E2E Harvest Fail Bed ${stamp}`, rect(200, 200, 200, 200));
    await createPlant(request, slug, `E2E Fail Blueberry ${stamp}`);
    const planting = await createPlanting(request, bed.id, slug);
    const action = await createHarvestAction(request, bed.id, slug);

    try {
      // Force the create-log request to fail server-side without touching
      // the real dev server process - route interception is the standard
      // Playwright way to simulate a backend failure deterministically.
      await page.route("**/api/harvest-logs", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "simulated failure" }) });
        }
        return route.continue();
      });

      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      await page.getByRole("button", { name: "Log a harvest" }).click();
      await page.getByLabel("Amount").fill("4.2");
      await page.getByLabel("Notes").fill("keeping this note on failure");
      await page.getByRole("button", { name: "Log harvest", exact: true }).click();

      // Dialog stays open, values intact, inline destructive error shown.
      await expect(page.getByLabel("Amount")).toHaveValue("4.2");
      await expect(page.getByLabel("Notes")).toHaveValue("keeping this note on failure");
      await expect(page.getByRole("button", { name: "Log harvest", exact: true })).toBeVisible();
      await expect(page.locator("form p.text-destructive")).toBeVisible();

      // Nothing was actually created (the request was intercepted/failed).
      expect((await harvestLogsFor(request, planting.id)).length).toBe(0);
    } finally {
      await page.unroute("**/api/harvest-logs");
      for (const log of await harvestLogsFor(request, planting.id)) {
        await request.delete(`/api/harvest-logs/${log.id}`).catch(() => {});
      }
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
