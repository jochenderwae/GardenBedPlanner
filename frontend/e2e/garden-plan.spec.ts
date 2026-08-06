import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #220 ("Garden plan / plantings wishlist frontend
 * UI") - the implementer's own outcome comment only manually verified a
 * single create-plan + single-entry + reload round trip. Not mentioned:
 * editing an entry's quantity/bed assignment, deleting an entry, leaving a
 * bed unassigned, multiple plans + the plan switcher, deleting a plan, or
 * reaching the page via the nav (all named in the ticket's own "How to
 * test" steps 1-5) - this spec closes those gaps. Desktop-only, per the
 * ticket's own settled Platform note - no mobile route exists for this page.
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

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function armPlant(page: Page, commonName: string): Promise<void> {
  await page.getByRole("button", { name: "Pick a plant" }).click();
  await page.getByRole("button", { name: new RegExp(commonName) }).click();
  await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);
}

async function plansMatching(request: APIRequestContext, seasonName: string) {
  const all = (await (await request.get("/api/garden-plans")).json()) as { id: number; season_name: string }[];
  return all.filter((p) => p.season_name === seasonName);
}

/** The plan header's own CardTitle - scoped via `[data-slot="card-title"]`
 * (shadcn `Card` renders a plain div there, not a semantic heading role,
 * same as `equipment-page.spec.ts`'s own `cardSection` helper documents)
 * rather than a bare `page.getByText`, which would also (ambiguously) match
 * the plan switcher's own identically-labeled `<option>` once more than one
 * plan exists. */
function planTitle(page: Page, seasonNamePattern: RegExp) {
  return page.locator('[data-slot="card-title"]', { hasText: seasonNamePattern });
}

test.describe("Garden plan / plantings wishlist (#220)", () => {
  test("is reachable from the hamburger menu, not just a direct URL", async ({ page }) => {
    await page.goto("/");
    await dismissOnboardingIfPresent(page);
    await page.getByRole("button", { name: "Open menu" }).click();

    const navLink = page.getByRole("link", { name: "Garden Plan" });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/garden-plan$/);
    await expect(page.getByRole("heading", { name: "Garden plan" })).toBeVisible();
  });

  test("create a plan, add entries with and without a bed assignment, and confirm both persist after reload", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const seasonName = `E2E Season ${stamp}`;
    const bed = await createBed(request, `E2E Plan Bed ${stamp}`, rect(200, 200, 100, 100));
    const slugA = `e2e-plan-tomato-${stamp}`;
    const slugB = `e2e-plan-basil-${stamp}`;
    await createPlant(request, slugA, `E2E Plan Tomato ${stamp}`);
    await createPlant(request, slugB, `E2E Plan Basil ${stamp}`);

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);

      // --- Step 1: create the plan with notes ---
      await page.getByRole("button", { name: "+ New plan" }).click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Season name").fill(seasonName);
      await createDialog.getByLabel("Notes").fill("First pass at next year's crops");
      await createDialog.getByRole("button", { name: "Create" }).click();

      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();

      const plans = await plansMatching(request, seasonName);
      expect(plans).toHaveLength(1);
      const planId = plans[0].id;

      // --- Step 2: add two entries - one with a bed, one unassigned ---
      // AddEntryForm's own quantity/bed fields are ambiguous against
      // getByLabel once an EntryRow with the same field labels exists too -
      // "Qty" placeholder and the raw aria-label attribute are each unique
      // to the add-form's own inputs.
      await armPlant(page, `E2E Plan Tomato ${stamp}`);
      await page.getByPlaceholder("Qty").fill("6");
      await page.locator('select[aria-label="Bed"]').selectOption(String(bed.id));
      await page.getByRole("button", { name: "Add" }).click();
      await expect(page.getByText(`E2E Plan Tomato ${stamp}`, { exact: true })).toBeVisible();

      await armPlant(page, `E2E Plan Basil ${stamp}`);
      await page.getByPlaceholder("Qty").fill("3");
      // Leave bed unassigned this time.
      await page.getByRole("button", { name: "Add" }).click();
      await expect(page.getByText(`E2E Plan Basil ${stamp}`, { exact: true })).toBeVisible();

      await expect(page.getByText(/^Plants \(2\)/)).toBeVisible();

      // --- Step 3: reload and confirm the plan + both entries persisted ---
      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();
      await expect(page.getByText(/^Plants \(2\)/)).toBeVisible();
      await expect(page.getByText(`E2E Plan Tomato ${stamp}`, { exact: true })).toBeVisible();
      await expect(page.getByText(`E2E Plan Basil ${stamp}`, { exact: true })).toBeVisible();

      const detail = await (await request.get(`/api/garden-plans/${planId}`)).json();
      expect(detail.notes).toBe("First pass at next year's crops");
      expect(detail.entries).toHaveLength(2);
      const tomatoEntry = detail.entries.find((e: { plant_slug: string }) => e.plant_slug === slugA);
      const basilEntry = detail.entries.find((e: { plant_slug: string }) => e.plant_slug === slugB);
      expect(tomatoEntry.desired_quantity).toBe(6);
      expect(tomatoEntry.bed_id).toBe(bed.id);
      expect(basilEntry.desired_quantity).toBe(3);
      expect(basilEntry.bed_id).toBeNull();
    } finally {
      const plans = await plansMatching(request, seasonName);
      for (const p of plans) await request.delete(`/api/garden-plans/${p.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${slugA}`).catch(() => {});
      await request.delete(`/api/plants/${slugB}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("editing an entry's quantity/bed assignment and deleting another entry both persist", async ({ page, request }) => {
    const stamp = Date.now();
    const seasonName = `E2E Edit Season ${stamp}`;
    const bedA = await createBed(request, `E2E Edit Bed A ${stamp}`, rect(200, 200, 100, 100));
    const bedB = await createBed(request, `E2E Edit Bed B ${stamp}`, rect(400, 200, 100, 100));
    const slugKeep = `e2e-plan-edit-keep-${stamp}`;
    const slugDelete = `e2e-plan-edit-delete-${stamp}`;
    await createPlant(request, slugKeep, `E2E Edit Keep ${stamp}`);
    await createPlant(request, slugDelete, `E2E Edit Delete ${stamp}`);

    const planRes = await request.post("/api/garden-plans", {
      data: { season_name: seasonName, year: new Date().getFullYear(), notes: "" },
    });
    const plan = await planRes.json();
    const entryKeepRes = await request.post(`/api/garden-plans/${plan.id}/entries`, {
      data: { plant_slug: slugKeep, bed_id: null, desired_quantity: 2, notes: "" },
    });
    const entryKeep = await entryKeepRes.json();
    const entryDeleteRes = await request.post(`/api/garden-plans/${plan.id}/entries`, {
      data: { plant_slug: slugDelete, bed_id: bedA.id, desired_quantity: 1, notes: "" },
    });
    const entryDelete = await entryDeleteRes.json();

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);
      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();
      await expect(page.getByText(/^Plants \(2\)/)).toBeVisible();

      // --- Edit the "keep" entry's quantity and bed assignment ---
      // Two levels up: the plant-name text sits in a <span> nested inside
      // an inner "name + delete button" div, itself inside EntryRow's own
      // outer row div that also holds the quantity/bed fields - same
      // pitfall `harvest-logging.spec.ts` hit with an identical row shape
      // (see that spec's own comment on why one ".." hop lands too shallow).
      const keepRow = page.getByText(`E2E Edit Keep ${stamp}`, { exact: true }).locator("..").locator("..");
      const quantityInput = keepRow.getByLabel("Desired quantity");
      await quantityInput.fill("9");
      await quantityInput.blur();
      const bedSelect = keepRow.getByLabel("Bed");
      await bedSelect.selectOption(String(bedB.id));

      await expect
        .poll(async () => (await (await request.get(`/api/garden-plans/${plan.id}`)).json()).entries.find((e: { id: number }) => e.id === entryKeep.id).desired_quantity, {
          message: "entry quantity edit never persisted",
        })
        .toBe(9);
      const afterEdit = await (await request.get(`/api/garden-plans/${plan.id}`)).json();
      const editedEntry = afterEdit.entries.find((e: { id: number }) => e.id === entryKeep.id);
      expect(editedEntry.bed_id).toBe(bedB.id);

      // --- Delete the other entry ---
      await page.getByRole("button", { name: `Remove E2E Edit Delete ${stamp} from the plan` }).click();
      await expect(page.getByText(`E2E Edit Delete ${stamp}`, { exact: true })).toHaveCount(0);
      // No standalone GET /entries/{id} route exists (only list/create/
      // update/delete) - confirm via the plan detail's own entries list
      // instead.
      await expect
        .poll(
          async () => {
            const detail = await (await request.get(`/api/garden-plans/${plan.id}`)).json();
            return detail.entries.some((e: { id: number }) => e.id === entryDelete.id);
          },
          { message: "deleted entry still exists server-side" },
        )
        .toBe(false);

      // The kept entry is still present (delete only removed the other one).
      await expect(page.getByText(`E2E Edit Keep ${stamp}`, { exact: true })).toBeVisible();
      await expect(page.getByText(/^Plants \(1\)/)).toBeVisible();
    } finally {
      await request.delete(`/api/garden-plans/${plan.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${slugKeep}`).catch(() => {});
      await request.delete(`/api/plants/${slugDelete}`).catch(() => {});
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
    }
  });

  test("multiple plans: the plan switcher lists both, and deleting the active plan removes it", async ({ page, request }) => {
    const stamp = Date.now();
    const seasonA = `E2E Multi Season A ${stamp}`;
    const seasonB = `E2E Multi Season B ${stamp}`;
    const planARes = await request.post("/api/garden-plans", {
      data: { season_name: seasonA, year: new Date().getFullYear(), notes: "" },
    });
    const planA = await planARes.json();
    const planBRes = await request.post("/api/garden-plans", {
      data: { season_name: seasonB, year: new Date().getFullYear() + 1, notes: "" },
    });
    const planB = await planBRes.json();

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);

      // /^Plan/ (not exact, not a bare substring either) - the <select>'s
      // own computed accessible name is "Plan" + its currently-selected
      // option's own text (the label wraps the control, so accname
      // computation folds the selected option's text into the label's
      // flattened name) so an exact "Plan" match finds nothing; a bare
      // substring match also resolves the unrelated "Delete plan" button
      // (whose own aria-label contains "Plan" too) - anchoring to the start
      // avoids both.
      const switcher = page.getByLabel(/^Plan/);
      await expect(switcher).toBeVisible();
      await expect(page.locator("option", { hasText: seasonA })).toHaveCount(1);
      await expect(page.locator("option", { hasText: seasonB })).toHaveCount(1);

      // Most-recently-created plan (B) is the default selection.
      await expect(planTitle(page, new RegExp(seasonB))).toBeVisible();

      // Switch to plan A explicitly.
      await switcher.selectOption(String(planA.id));
      await expect(planTitle(page, new RegExp(seasonA))).toBeVisible();

      // Delete the now-active plan (A).
      await page.getByRole("button", { name: "Delete plan" }).click();
      await expect
        .poll(async () => (await request.get(`/api/garden-plans/${planA.id}`)).status(), {
          message: "deleted plan still exists server-side",
        })
        .toBe(404);
      // Plan B still exists, untouched.
      expect((await request.get(`/api/garden-plans/${planB.id}`)).status()).toBe(200);
    } finally {
      await request.delete(`/api/garden-plans/${planA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/garden-plans/${planB.id}?cascade=true`).catch(() => {});
    }
  });
});
