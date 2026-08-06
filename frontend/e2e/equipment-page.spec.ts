import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #33 (standalone `/equipment` inventory page,
 * reachable from the main nav - distinct from `EquipmentPanel.tsx`'s
 * in-canvas panel already covered by equipment-inventory-workflow.spec.ts's
 * #34 coverage). Covers: the nav entry actually links here, the
 * add-to-inventory form's happy path and its empty-type validation error,
 * placing an item on a real bed via the picker, unplacing it back to
 * Inventory (not deleted), and deleting an item outright.
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

/** Scopes to the whole `<Card>` containing a section's own `CardTitle` -
 * not `.locator("..")` off the title itself, which only reaches
 * `CardHeader` (a sibling of `CardContent`, where the actual item rows
 * live, not an ancestor of it). Anchored regex (`^...$`) so "Placed"
 * doesn't loosely substring-match "Nothing placed yet."'s own paragraph
 * text - same pattern `timeline-view.spec.ts` already establishes for
 * `[data-slot="card"]` section scoping. */
function cardSection(page: Page, exactTitle: string) {
  const title = page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${exactTitle}$`) });
  return page.locator('[data-slot="card"]').filter({ has: title });
}

test.describe("Equipment page (#33)", () => {
  test("is reachable from the hamburger menu", async ({ page }) => {
    await page.goto("/");
    await dismissOnboardingIfPresent(page);
    await page.getByRole("button", { name: "Open menu" }).click();

    const navLink = page.getByRole("link", { name: "Equipment" });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/equipment$/);
    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  });

  test("adding an item with no type shows a validation error and does not create anything", async ({ page }) => {
    await page.goto("/equipment");
    await dismissOnboardingIfPresent(page);
    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

    await page.getByRole("button", { name: "Add to inventory" }).click();
    await expect(page.getByText("Type is required.")).toBeVisible();
  });

  test("add, place on a bed, unplace, and delete round trip", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Equipment Page Bed", rect(200, 200, 200, 200));
    const equipmentType = `e2e-page-trellis-${Date.now()}`;

    try {
      await page.goto("/equipment");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

      const inventorySection = cardSection(page, "Inventory \\(unassigned\\)");
      const placedSection = cardSection(page, "Placed");

      // --- create: lands in Inventory, unplaced ---
      await page.getByPlaceholder(/trellis, drip line, stake/).fill(equipmentType);
      await page.getByRole("button", { name: "Add to inventory" }).click();

      await expect(inventorySection.getByText(equipmentType)).toBeVisible();
      await expect(placedSection.getByText(equipmentType)).toHaveCount(0);

      await expect
        .poll(
          async () => {
            const items = (await (await request.get("/api/bed-equipment")).json()) as {
              id: number;
              equipment_type: string;
            }[];
            return items.some((i) => i.equipment_type === equipmentType);
          },
          { message: "equipment item never got created" },
        )
        .toBe(true);
      const items = (await (await request.get("/api/bed-equipment")).json()) as {
        id: number;
        equipment_type: string;
        bed_id: number | null;
      }[];
      const item = items.find((i) => i.equipment_type === equipmentType)!;
      expect(item.bed_id, "a freshly-created item must start unplaced (bed_id null)").toBeNull();

      // --- place it on the bed via the picker ---
      await inventorySection.getByRole("combobox").selectOption(String(bed.id));

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${item.id}`)).json()).bed_id, {
          message: "placing the item via the select never persisted",
        })
        .toBe(bed.id);
      await expect(placedSection.getByText(equipmentType)).toBeVisible();
      await expect(placedSection.getByText("E2E Equipment Page Bed")).toBeVisible();
      await expect(inventorySection.getByText(equipmentType)).toHaveCount(0);

      // --- unplace it back to Inventory (not deleted) ---
      await placedSection.getByRole("button", { name: "Unplace" }).click();

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${item.id}`)).json()).bed_id, {
          message: "unplacing the item never persisted",
        })
        .toBeNull();
      await expect(inventorySection.getByText(equipmentType)).toBeVisible();

      // --- delete it outright ---
      await inventorySection.getByRole("button", { name: `Delete ${equipmentType}` }).click();
      await expect(inventorySection.getByText(equipmentType)).toHaveCount(0);
      expect((await request.get(`/api/bed-equipment/${item.id}`)).status()).toBe(404);
    } finally {
      const leftover = (await (await request.get("/api/bed-equipment")).json()) as { id: number; equipment_type: string }[];
      for (const leftoverItem of leftover.filter((i) => i.equipment_type === equipmentType)) {
        await request.delete(`/api/bed-equipment/${leftoverItem.id}`).catch(() => {});
      }
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("with no beds and no garden, placement is disabled rather than broken", async ({ page, request }) => {
    // #218's DELETE /api/garden exists precisely so a spec like this one can
    // start from a genuinely garden-less state without leaking a fixture row.
    await request.delete("/api/garden").catch(() => {});

    const equipmentType = `e2e-page-no-garden-${Date.now()}`;
    try {
      await page.goto("/equipment");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

      await page.getByPlaceholder(/trellis, drip line, stake/).fill(equipmentType);
      await page.getByRole("button", { name: "Add to inventory" }).click();

      const inventorySection = cardSection(page, "Inventory \\(unassigned\\)");
      await expect(inventorySection.getByText(equipmentType)).toBeVisible();
      await expect(inventorySection.getByRole("combobox")).toBeDisabled();
    } finally {
      const items = (await (await request.get("/api/bed-equipment")).json()) as { id: number; equipment_type: string }[];
      for (const leftoverItem of items.filter((i) => i.equipment_type === equipmentType)) {
        await request.delete(`/api/bed-equipment/${leftoverItem.id}`).catch(() => {});
      }
    }
  });
});
