import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #277 ("GardenPlan UI: allow blank/not-yet-
 * assigned quantity input"). `garden-plan.spec.ts`'s own pre-existing
 * quantity-edit coverage only ever fills in a real number - it never
 * exercises the actual point of this ticket: clearing the field entirely
 * (in either `AddEntryForm` or an existing `EntryRow`) must persist
 * `desired_quantity: null`, not coerce to `0`/`1`, and the field must
 * render as genuinely blank (placeholder "Not yet assigned") rather than
 * "0" once that's the persisted state - including on a fresh page load,
 * not just immediately after the edit.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createPlan(request: APIRequestContext, seasonName: string): Promise<{ id: number }> {
  const res = await request.post("/api/garden-plans", {
    data: { season_name: seasonName, year: new Date().getFullYear(), notes: "" },
  });
  expect(res.ok(), `failed to create plan "${seasonName}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createEntry(
  request: APIRequestContext,
  planId: number,
  overrides: Record<string, unknown>,
): Promise<{ id: number }> {
  const res = await request.post(`/api/garden-plans/${planId}/entries`, {
    data: { bed_id: null, desired_quantity: 1, notes: "", ...overrides },
  });
  expect(res.ok(), `failed to create entry: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
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

function planTitle(page: Page, seasonNamePattern: RegExp) {
  return page.locator('[data-slot="card-title"]', { hasText: seasonNamePattern });
}

/** Same "two `..` hops to reach EntryRow's own outer row div" pattern
 * `garden-plan.spec.ts` already documents for this exact row shape. */
function entryRow(page: Page, commonName: string) {
  return page.getByText(commonName, { exact: true }).locator("..").locator("..");
}

async function getEntryQuantity(request: APIRequestContext, planId: number, entryId: number): Promise<number | null> {
  const detail = await (await request.get(`/api/garden-plans/${planId}`)).json();
  return detail.entries.find((e: { id: number }) => e.id === entryId)?.desired_quantity ?? null;
}

test.describe("GardenPlan blank/not-yet-assigned quantity (#277)", () => {
  test("AddEntryForm: clearing the Qty field before adding creates the entry with desired_quantity null, not 0 or 1", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const seasonName = `E2E Blank Qty New Season ${stamp}`;
    const slug = `e2e-blankqty-new-${stamp}`;
    const plantName = `E2E Blank Qty New Plant ${stamp}`;
    await createPlant(request, slug, plantName);
    const plan = await createPlan(request, seasonName);

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);
      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();

      await armPlant(page, plantName);
      // Clear the "1" default entirely rather than typing a number.
      await page.getByPlaceholder("Qty").fill("");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect(page.getByText(plantName, { exact: true })).toBeVisible();

      let entry: { desired_quantity: number | null; plant_slug: string } | undefined;
      await expect
        .poll(
          async () => {
            const detail = await (await request.get(`/api/garden-plans/${plan.id}`)).json();
            entry = detail.entries.find((e: { plant_slug: string }) => e.plant_slug === slug);
            return entry != null;
          },
          { message: "entry was never created" },
        )
        .toBe(true);
      expect(entry!.desired_quantity).toBeNull();

      // Renders as genuinely blank with the "Not yet assigned" placeholder,
      // not "0".
      const quantityInput = entryRow(page, plantName).getByLabel("Desired quantity");
      await expect(quantityInput).toHaveValue("");
      await expect(quantityInput).toHaveAttribute("placeholder", "Not yet assigned");
    } finally {
      await request.delete(`/api/garden-plans/${plan.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("EntryRow: clearing an existing entry's quantity and blurring persists null and survives a reload", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const seasonName = `E2E Blank Qty Edit ${stamp}`;
    const slug = `e2e-blankqty-edit-${stamp}`;
    await createPlant(request, slug, `E2E Blank Qty Edit Plant ${stamp}`);
    const plan = await createPlan(request, seasonName);
    const entry = await createEntry(request, plan.id, { plant_slug: slug, desired_quantity: 5 });

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);
      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();

      const quantityInput = entryRow(page, `E2E Blank Qty Edit Plant ${stamp}`).getByLabel("Desired quantity");
      await expect(quantityInput).toHaveValue("5");
      await quantityInput.fill("");
      await quantityInput.blur();

      await expect
        .poll(async () => getEntryQuantity(request, plan.id, entry.id), { message: "clearing the quantity field never persisted null" })
        .toBeNull();

      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();
      const quantityInputAfterReload = entryRow(page, `E2E Blank Qty Edit Plant ${stamp}`).getByLabel("Desired quantity");
      await expect(quantityInputAfterReload).toHaveValue("");
      await expect(quantityInputAfterReload).toHaveAttribute("placeholder", "Not yet assigned");
    } finally {
      await request.delete(`/api/garden-plans/${plan.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("EntryRow: an entry created with no quantity loads with a blank field, and typing a number then blurring saves it", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const seasonName = `E2E Blank Qty Preexisting ${stamp}`;
    const slug = `e2e-blankqty-pre-${stamp}`;
    await createPlant(request, slug, `E2E Blank Qty Pre Plant ${stamp}`);
    const plan = await createPlan(request, seasonName);
    const entry = await createEntry(request, plan.id, { plant_slug: slug, desired_quantity: null });

    try {
      await page.goto("/garden-plan");
      await dismissOnboardingIfPresent(page);
      await expect(planTitle(page, new RegExp(seasonName))).toBeVisible();

      const quantityInput = entryRow(page, `E2E Blank Qty Pre Plant ${stamp}`).getByLabel("Desired quantity");
      await expect(quantityInput).toHaveValue("");
      await expect(quantityInput).toHaveAttribute("placeholder", "Not yet assigned");

      await quantityInput.fill("4");
      await quantityInput.blur();

      await expect
        .poll(async () => getEntryQuantity(request, plan.id, entry.id), { message: "typing a real quantity into a previously-blank field never persisted" })
        .toBe(4);
    } finally {
      await request.delete(`/api/garden-plans/${plan.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
