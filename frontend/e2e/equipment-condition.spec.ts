import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #244 ("BedEquipment.condition field - frontend
 * (EquipmentPanel unplace flow + inventory list)"). Neither of the two
 * pre-existing equipment specs (equipment-inventory-workflow.spec.ts's
 * canvas-editor #34 coverage, equipment-page.spec.ts's standalone-page #33
 * coverage) exercises `condition` at all - both click the bare "Unplace"
 * button and never look at a badge, so this ticket's own actual surface
 * (`UnplaceControl`'s condition picker, `ConditionBadge`, and the withheld
 * placement picker for a damaged/retired item) had zero coverage before
 * this file. Covers both call sites (`EquipmentPanel.tsx` canvas editor tab
 * and the standalone `Equipment.tsx` page), per the ticket's own "two call
 * sites" note.
 *
 * Row scoping: every assertion locates a specific item's Inventory row by
 * walking up exactly two `<div>` levels from its own uniquely-aria-labelled
 * "Delete {type}" button - confirmed against both `Equipment.tsx`'s and
 * `EquipmentPanel.tsx`'s actual JSX to land on the row that also contains
 * that item's badge/placement controls in both places (in both, the
 * button's own parent is a small "controls" div, and *that* div's parent is
 * the row). An earlier "innermost div containing both the type text and the
 * delete button" attempt looked more robust on paper but actually broke on
 * `EquipmentPanel.tsx` specifically - its Inventory row has one extra
 * wrapping div (a header row for just the type+badge+delete button, sibling
 * to the placement-picker/"Not available" line below it) that also
 * satisfies "contains both", so `.last()` picked that too-narrow header div
 * instead of the real row and missed the placement text - confirmed
 * empirically while writing this file. Deliberately *not* an exact-text
 * match on the type name either: `ConditionBadge` renders inline right
 * after it inside the same `<span>` with no separating text node (e.g.
 * "e2e-cond-page-123Damaged"), so an exact match against the bare type name
 * alone never matches once a badge is present - a substring match is what
 * the timestamp-suffixed type names stay unique enough for regardless.
 *
 * Cleanup: creating (or PATCHing) equipment already assigned to a bed
 * triggers `generate_equipment_tasks` (task_generation.py) server-side,
 * which creates an `install_equipment` Action referencing the equipment's
 * id - deleting the equipment while that Action still exists trips the FK
 * constraint (409 via `commit_or_409`), also confirmed empirically (a
 * naive `DELETE /api/bed-equipment/:id` cleanup silently 409'd and leaked
 * rows between runs). `cleanupEquipment` deletes any such dependent Action
 * first.
 */

function itemRow(page: Page, equipmentType: string): Locator {
  return page.getByRole("button", { name: `Delete ${equipmentType}` }).locator("../..");
}

async function createBed(request: APIRequestContext, name: string, geometry: { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number }): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createEquipment(request: APIRequestContext, overrides: Record<string, unknown>): Promise<{ id: number }> {
  const res = await request.post("/api/bed-equipment", {
    data: { equipment_type: `e2e-cond-${Date.now()}-${Math.random().toString(36).slice(2)}`, owned: true, ...overrides },
  });
  expect(res.ok(), `failed to create equipment: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function fetchEquipment(request: APIRequestContext, id: number) {
  return (await (await request.get(`/api/bed-equipment/${id}`)).json()) as { condition: string; bed_id: number | null };
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function cleanupEquipment(request: APIRequestContext, ids: number[]): Promise<void> {
  const actions = (await (await request.get("/api/actions")).json()) as { id: number; equipment_id: number | null }[];
  for (const action of actions.filter((a) => a.equipment_id != null && ids.includes(a.equipment_id as number))) {
    await request.delete(`/api/actions/${action.id}`).catch(() => {});
  }
  for (const id of ids) await request.delete(`/api/bed-equipment/${id}`).catch(() => {});
}

const rect = { type: "rectangle" as const, x: 200, y: 200, width: 200, height: 200, rotation: 0 };

test.describe("Equipment condition on unplace + inventory list (#244)", () => {
  test("standalone /equipment page: unplacing with 'Damaged' selected persists condition, shows the badge, and withholds the placement picker", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Condition Page Bed", rect);
    const equipmentType = `e2e-cond-page-${Date.now()}`;
    const item = await createEquipment(request, { equipment_type: equipmentType, bed_id: bed.id });

    try {
      await page.goto("/equipment");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();

      const combobox = page.getByRole("combobox", { name: `Condition when unplacing ${equipmentType}` });
      await expect(combobox).toBeVisible();
      await combobox.selectOption("damaged");
      await combobox.locator("..").getByRole("button", { name: "Unplace" }).click();

      await expect
        .poll(async () => (await fetchEquipment(request, item.id)).bed_id, { message: "unplace never persisted bed_id=null" })
        .toBeNull();
      await expect
        .poll(async () => (await fetchEquipment(request, item.id)).condition, { message: "unplace never persisted condition=damaged" })
        .toBe("damaged");

      const row = itemRow(page, equipmentType);
      await expect(row.getByText(equipmentType)).toBeVisible();
      await expect(row.getByText("Damaged", { exact: true })).toBeVisible();
      await expect(row.getByRole("combobox")).toHaveCount(0);
      await expect(row.getByText(/Not available to place - damaged\./)).toBeVisible();
    } finally {
      await cleanupEquipment(request, [item.id]);
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("canvas editor Equipment tab: unplacing with 'Retired' selected persists condition and withholds placement there too", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Condition Canvas Bed", rect);
    const equipmentType = `e2e-cond-canvas-${Date.now()}`;
    const item = await createEquipment(request, { equipment_type: equipmentType, bed_id: bed.id });

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Equipment" }).click();
      await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toBeVisible();

      const combobox = page.getByRole("combobox", { name: `Condition when unplacing ${equipmentType}` });
      await expect(combobox).toBeVisible();
      await combobox.selectOption("retired");
      await combobox.locator("..").getByRole("button", { name: "Unplace" }).click();

      await expect
        .poll(async () => (await fetchEquipment(request, item.id)).bed_id, { message: "unplace never persisted bed_id=null" })
        .toBeNull();
      await expect
        .poll(async () => (await fetchEquipment(request, item.id)).condition, { message: "unplace never persisted condition=retired" })
        .toBe("retired");

      const row = itemRow(page, equipmentType);
      await expect(row.getByText(equipmentType)).toBeVisible();
      await expect(row.getByText("Retired", { exact: true })).toBeVisible();
      await expect(row.getByRole("combobox")).toHaveCount(0);
      await expect(row.getByText(/Not available to place - retired\./)).toBeVisible();
    } finally {
      await cleanupEquipment(request, [item.id]);
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("an already-damaged inventory item shows its badge and withheld placement picker on load, in both views", async ({
    page,
    request,
  }) => {
    const equipmentType = `e2e-cond-preexisting-${Date.now()}`;
    const item = await createEquipment(request, { equipment_type: equipmentType, condition: "damaged" });

    try {
      await page.goto("/equipment");
      await dismissOnboardingIfPresent(page);
      const pageRow = itemRow(page, equipmentType);
      await expect(pageRow.getByText(equipmentType)).toBeVisible();
      await expect(pageRow.getByText("Damaged", { exact: true })).toBeVisible();
      await expect(pageRow.getByRole("combobox")).toHaveCount(0);
      await expect(pageRow.getByText(/Not available to place - damaged\./)).toBeVisible();

      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Equipment" }).click();
      await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toBeVisible();
      const canvasRow = itemRow(page, equipmentType);
      await expect(canvasRow.getByText(equipmentType)).toBeVisible();
      await expect(canvasRow.getByText("Damaged", { exact: true })).toBeVisible();
      await expect(canvasRow.getByText(/Not available to place - damaged\./)).toBeVisible();
    } finally {
      await cleanupEquipment(request, [item.id]);
    }
  });

  test("a 'good' condition item shows no badge and keeps its normal placement picker", async ({ page, request }) => {
    const equipmentType = `e2e-cond-plain-${Date.now()}`;
    const item = await createEquipment(request, { equipment_type: equipmentType });

    try {
      await page.goto("/equipment");
      await dismissOnboardingIfPresent(page);
      const row = itemRow(page, equipmentType);
      await expect(row.getByText(equipmentType)).toBeVisible();
      await expect(row.getByText("Good", { exact: true })).toHaveCount(0); // "good" is the quiet default - no badge drawn at all
      await expect(row.getByText(/Not available to place/)).toHaveCount(0);
      await expect(row.getByRole("combobox")).toBeVisible(); // the real placement picker, not withheld
    } finally {
      await cleanupEquipment(request, [item.id]);
    }
  });
});
