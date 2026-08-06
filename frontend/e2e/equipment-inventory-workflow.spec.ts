import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #34 ("Equipment should be 'retrieved from
 * stock,' not authored directly in the bed layout editor") - all 3 of the
 * ticket's own "How to test" steps are real form-submit/select/click
 * interactions against `EquipmentPanel.tsx`'s two-section (Inventory/
 * Placed) UI, which neither a typecheck nor a Vitest/jsdom test can
 * exercise. The ticket has no implementer outcome comment to quote either
 * way.
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

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("Equipment: create unplaced, place, unplace (#34)", () => {
  test("a new equipment item is created unplaced, can be placed on a bed, and unplaced back to inventory without being deleted", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Equipment Bed", rect(200, 200, 200, 200));
    const equipmentType = `e2e-trellis-${Date.now()}`;

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Equipment" }).click();
      // exact: true - a non-exact match now also resolves the irrigation
      // editor merge's (#250) own "Irrigation zones..." heading whose
      // accessible name happens to contain "equipment" too, since both
      // panels now share this tab.
      await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toBeVisible();

      // Role-scoped (not the old `text=Placed` substring locator) - that
      // engine's case-insensitive substring match also hits "Nothing
      // **placed** yet." (the section's own empty-state copy), an ambiguity
      // that got newly load-bearing once #250's irrigation merge added more
      // content to this same panel around it.
      const inventorySection = page.getByRole("heading", { name: "Inventory (unassigned)", exact: true }).locator("..");
      const placedSection = page.getByRole("heading", { name: "Placed", exact: true }).locator("..");

      // --- Step 1: create it - no bed required, lands in Inventory ---
      await page.getByPlaceholder(/trellis, drip line, stake/).fill(equipmentType);
      await page.getByRole("button", { name: "Add to inventory" }).click();

      await expect(inventorySection.getByText(equipmentType, { exact: true })).toBeVisible();
      await expect(placedSection.getByText(equipmentType, { exact: true })).toHaveCount(0);

      const allItems = (await (await request.get("/api/bed-equipment")).json()) as {
        id: number;
        equipment_type: string;
        bed_id: number | null;
        owned: boolean;
      }[];
      const created = allItems.find((i) => i.equipment_type === equipmentType);
      expect(created, "equipment item never got created").toBeTruthy();
      expect(created!.bed_id, "a freshly-created item must start unplaced (bed_id null)").toBeNull();
      // #272 regression: EquipmentPanel.tsx's create payload must include
      // the now-required `owned` field (added by #255) - true by default for
      // this "I have this item in hand" inventory form.
      expect(created!.owned).toBe(true);

      // --- Step 2: place it on the bed ---
      await inventorySection.getByRole("combobox").selectOption(String(bed.id));

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${created!.id}`)).json()).bed_id, {
          message: "placing the item via the select never persisted",
        })
        .toBe(bed.id);
      await expect(placedSection.getByText(equipmentType, { exact: true })).toBeVisible();
      await expect(placedSection.getByText("E2E Equipment Bed")).toBeVisible();
      await expect(inventorySection.getByText(equipmentType, { exact: true })).toHaveCount(0);

      // --- Step 3: unplace it - back to Inventory, not deleted ---
      await placedSection.getByRole("button", { name: "Unplace" }).click();

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${created!.id}`)).json()).bed_id, {
          message: "unplacing the item never persisted",
        })
        .toBeNull();
      await expect(inventorySection.getByText(equipmentType, { exact: true })).toBeVisible();
      await expect(placedSection.getByText(equipmentType, { exact: true })).toHaveCount(0);
      // Still exists (not deleted) - already implied by the poll above
      // succeeding, but double-check the direct GET too.
      expect((await request.get(`/api/bed-equipment/${created!.id}`)).status()).toBe(200);
    } finally {
      const items = (await (await request.get("/api/bed-equipment")).json()) as { id: number; equipment_type: string }[];
      for (const item of items.filter((i) => i.equipment_type === equipmentType)) {
        await request.delete(`/api/bed-equipment/${item.id}`).catch(() => {});
      }
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
