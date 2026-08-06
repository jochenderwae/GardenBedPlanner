import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #270 ("Shopping list view - frontend, consumes
 * GET /api/shopping-list from #255"). The implementer's own outcome
 * comment verified this with a live Playwright screenshot but no committed
 * spec - `GET /api/shopping-list` itself already has solid backend pytest
 * coverage (test_shopping_list.py); what's untested is the frontend page:
 * does it actually reach the two real shortfall sources (an irrigation
 * part short on stock, an unowned piece of equipment), group them into the
 * right section, aggregate same-type equipment into one row with the right
 * count, and does resolving the underlying shortfall (bumping stock /
 * marking owned) make the row disappear again - plus the two real
 * discoverability paths the ticket called out (nav entry, Equipment page
 * link).
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

async function createIrrigationPart(
  request: APIRequestContext,
  name: string,
  partType: string,
  quantityOnHand: number,
): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-parts", {
    data: { name, part_type: partType, quantity_on_hand: quantityOnHand, notes: "", connector_size_mm: null },
  });
  expect(res.ok(), `failed to create irrigation part "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createIrrigationPartInstance(
  request: APIRequestContext,
  partId: number,
  bedId: number,
): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-part-instances", {
    data: { part_id: partId, bed_id: bedId, garden_id: null, geometry: null, diagram_x: null, diagram_y: null },
  });
  expect(res.ok(), `failed to create irrigation part instance: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createUnownedEquipment(
  request: APIRequestContext,
  equipmentType: string,
  bedId: number,
): Promise<{ id: number }> {
  const res = await request.post("/api/bed-equipment", {
    data: { equipment_type: equipmentType, owned: false, bed_id: bedId },
  });
  expect(res.ok(), `failed to create unowned equipment: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** Scopes to the whole Card containing a section's own CardTitle - same
 * pattern `equipment-page.spec.ts`'s own `cardSection` helper establishes,
 * anchored so "Irrigation parts (N)" doesn't loosely substring-match
 * anything else on the page. */
function cardSection(page: Page, titlePattern: RegExp) {
  const title = page.locator('[data-slot="card-title"]', { hasText: titlePattern });
  return page.locator('[data-slot="card"]').filter({ has: title });
}

test.describe("Shopping list view (#270)", () => {
  test("is reachable from the hamburger menu", async ({ page }) => {
    await page.goto("/");
    await dismissOnboardingIfPresent(page);
    await page.getByRole("button", { name: "Open menu" }).click();

    const navLink = page.getByRole("link", { name: "Shopping list" });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/shopping-list$/);
    await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();
  });

  test("is also reachable from the Equipment page's own header link", async ({ page }) => {
    await page.goto("/equipment");
    await dismissOnboardingIfPresent(page);
    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

    await page.getByRole("link", { name: "Shopping list" }).click();
    await expect(page).toHaveURL(/\/shopping-list$/);
    await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();
  });

  test("an equipment shortfall groups same-type unowned items into one row with the right count, and disappears once marked owned", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Shopping Equip Bed ${stamp}`, rect(200, 200, 100, 100));
    const equipmentType = `e2e-shop-trellis-${stamp}`;
    const itemA = await createUnownedEquipment(request, equipmentType, bed.id);
    const itemB = await createUnownedEquipment(request, equipmentType, bed.id);

    try {
      await page.goto("/shopping-list");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();

      const equipmentSection = cardSection(page, /^Equipment/);
      const row = equipmentSection.getByText(equipmentType, { exact: true }).locator("..").locator("..");
      await expect(row.getByText("need 2")).toBeVisible();

      // Not listed under Irrigation parts.
      const irrigationSection = cardSection(page, /^Irrigation parts/);
      await expect(irrigationSection.getByText(equipmentType)).toHaveCount(0);

      // Resolve both - mark owned.
      await request.patch(`/api/bed-equipment/${itemA.id}`, { data: { owned: true } });
      await request.patch(`/api/bed-equipment/${itemB.id}`, { data: { owned: true } });

      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();
      await expect(page.getByText(equipmentType)).toHaveCount(0);
    } finally {
      await request.delete(`/api/bed-equipment/${itemA.id}`).catch(() => {});
      await request.delete(`/api/bed-equipment/${itemB.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("an irrigation-part shortfall (more instances placed than on hand) shows under Irrigation parts, and disappears once stock covers it", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Shopping Irrigation Bed ${stamp}`, rect(200, 200, 100, 100));
    const partName = `E2E Shopping Drip Nozzle ${stamp}`;
    const part = await createIrrigationPart(request, partName, `e2e-shop-part-type-${stamp}`, 0);
    const instance = await createIrrigationPartInstance(request, part.id, bed.id);

    try {
      await page.goto("/shopping-list");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();

      const irrigationSection = cardSection(page, /^Irrigation parts/);
      const row = irrigationSection.getByText(partName, { exact: true }).locator("..").locator("..");
      await expect(row.getByText("need 1")).toBeVisible();

      const equipmentSection = cardSection(page, /^Equipment/);
      await expect(equipmentSection.getByText(partName)).toHaveCount(0);

      // Resolve - stock now covers the one placed instance.
      await request.patch(`/api/irrigation-parts/${part.id}`, { data: { quantity_on_hand: 1 } });

      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Shopping list" })).toBeVisible();
      await expect(page.getByText(partName)).toHaveCount(0);
    } finally {
      await request.delete(`/api/irrigation-part-instances/${instance.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${part.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
