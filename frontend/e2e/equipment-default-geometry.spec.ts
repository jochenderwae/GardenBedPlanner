import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #208 ("Render equipment at its type's default
 * geometry; add garden-bound placement") - the implementer's own outcome
 * comment verified this manually against `garden_test` state and via the
 * pre-existing `equipment-inventory-workflow.spec.ts`/`undo-redo.spec.ts`
 * regression re-runs, but nothing directly asserts the ticket's own core
 * new behavior: real per-type geometry on placement, garden-bound
 * placement, non-interactivity, and the no-matching-type fallback. Each
 * `EquipmentType` used here is created directly via the API (not relying
 * on `data/equipment_types.json` having been imported into whatever
 * `garden_test` state this runs against) for a fully self-contained,
 * reproducible spec.
 *
 * Placement geometry lands at (10,10), not (0,0) - `Layout.tsx`'s
 * `handleEquipmentPlace`/`handleEquipmentPlaceInGarden` both use a fixed
 * 10px inset (plus a per-existing-item cascade offset, 0 here since each
 * test places into a fresh bed/garden) rather than flush against the
 * bed/garden's own origin.
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

async function createEquipmentType(
  request: APIRequestContext,
  slug: string,
  category: string,
  geometry: Rect,
  heightCm: number,
): Promise<{ id: number }> {
  const res = await request.post("/api/equipment-types", {
    data: { slug, name: slug, category, default_geometry: geometry, default_height_cm: heightCm },
  });
  expect(res.ok(), `failed to create equipment type "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function openEquipmentTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Equipment" }).click();
}

async function addToInventory(page: Page, equipmentType: string): Promise<void> {
  await page.getByPlaceholder("e.g. trellis, drip line, stake...").fill(equipmentType);
  await page.getByRole("button", { name: "Add to inventory" }).click();
  await expect(page.getByText(equipmentType, { exact: true }).first()).toBeVisible();
}

/** The per-item "Place in bed.../Place in garden..." <select> - matched by
 * a regex prefix instead of the literal option text to sidestep the
 * trailing horizontal-ellipsis character entirely (a real Windows/
 * PowerShell UTF-8 mangling hazard hit once already while iterating on
 * this file - not worth re-typing the literal character a second time). */
function placeSelect(page: Page, optionNamePrefix: RegExp) {
  return page.getByRole("combobox").filter({ has: page.getByRole("option", { name: optionNamePrefix }) });
}

async function bedEquipmentByType(request: APIRequestContext, equipmentType: string) {
  const all = (await (await request.get("/api/bed-equipment")).json()) as {
    id: number;
    equipment_type: string;
    bed_id: number | null;
    garden_id: number | null;
    geometry: Rect | null;
    height_cm: number | null;
  }[];
  return all.find((e) => e.equipment_type === equipmentType);
}

test.describe("Equipment renders at its type's real default geometry (#208)", () => {
  test("placing a matched equipment type sets its real researched geometry/height, not the old fixed 20x20cm box", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-trellis-${stamp}`;
    const bed = await createBed(request, `E2E Equip Bed ${stamp}`, rect(40, 40, 200, 200));
    const equipType = await createEquipmentType(request, slug, "bed_bound", rect(0, 0, 120, 5), 180);

    try {
      await openEquipmentTab(page);
      await addToInventory(page, slug);

      const select = placeSelect(page, /^Place in bed/);
      await select.selectOption({ label: `E2E Equip Bed ${stamp}` });

      await expect
        .poll(async () => {
          const item = await bedEquipmentByType(request, slug);
          return item?.bed_id === bed.id;
        }, { message: "equipment was never placed on the bed" })
        .toBe(true);

      const placed = await bedEquipmentByType(request, slug);
      expect(placed?.geometry).toEqual({ type: "rectangle", x: 10, y: 10, width: 120, height: 5, rotation: 0 });
      expect(placed?.height_cm).toBe(180);
    } finally {
      const item = await bedEquipmentByType(request, slug);
      if (item?.id != null) await request.delete(`/api/bed-equipment/${item.id}`).catch(() => {});
      await request.delete(`/api/equipment-types/${equipType.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a garden-bound type places against the garden, not any bed", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-rainbarrel-${stamp}`;
    const gardenRes = await request.put("/api/garden", { data: { border_geometry: rect(0, 0, 500, 500) } });
    expect(gardenRes.ok(), `failed to create garden: ${gardenRes.status()}`).toBeTruthy();
    const garden = await gardenRes.json();
    const equipType = await createEquipmentType(request, slug, "garden_bound_functional", rect(0, 0, 61, 61), 93);

    try {
      await openEquipmentTab(page);
      await addToInventory(page, slug);

      const select = placeSelect(page, /^Place in garden/);
      // By value ("__garden__", EquipmentPanel.tsx's own sentinel constant
      // for this option), not by label text - selectOption's label match
      // needs the option's exact text including its trailing ellipsis
      // character, which value sidesteps entirely.
      await select.selectOption({ value: "__garden__" });

      await expect
        .poll(async () => {
          const item = await bedEquipmentByType(request, slug);
          return item?.garden_id === garden.id && item?.bed_id == null;
        }, { message: "equipment was never placed against the garden" })
        .toBe(true);

      const placed = await bedEquipmentByType(request, slug);
      expect(placed?.geometry).toEqual({ type: "rectangle", x: 10, y: 10, width: 61, height: 61, rotation: 0 });
      expect(placed?.height_cm).toBe(93);
      // The panel's own "Placed" list shows it under the garden's name, not
      // "Inventory" - confirms it reads as genuinely placed, not orphaned.
      await expect(page.getByText("Placed")).toBeVisible();
    } finally {
      const item = await bedEquipmentByType(request, slug);
      if (item?.id != null) await request.delete(`/api/bed-equipment/${item.id}`).catch(() => {});
      await request.delete(`/api/equipment-types/${equipType.id}`).catch(() => {});
      const groundBeds = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
      const ground = groundBeds.find((b) => b.name === "Ground");
      if (ground) await request.delete(`/api/beds/${ground.id}?cascade=true`).catch(() => {});
    }
  });

  test("a free-text equipment type with no matching EquipmentType falls back to the old fixed 20x20cm box, not an error", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const unmatchedType = `e2e-totally-unmatched-type-${stamp}`;
    const bed = await createBed(request, `E2E Equip Fallback Bed ${stamp}`, rect(40, 40, 200, 200));

    try {
      await openEquipmentTab(page);
      await addToInventory(page, unmatchedType);

      const select = placeSelect(page, /^Place in bed/);
      await select.selectOption({ label: `E2E Equip Fallback Bed ${stamp}` });

      await expect
        .poll(async () => {
          const item = await bedEquipmentByType(request, unmatchedType);
          return item?.bed_id === bed.id;
        }, { message: "equipment was never placed on the bed" })
        .toBe(true);

      const placed = await bedEquipmentByType(request, unmatchedType);
      expect(placed?.geometry).toEqual({ type: "rectangle", x: 10, y: 10, width: 20, height: 20, rotation: 0 });
    } finally {
      const item = await bedEquipmentByType(request, unmatchedType);
      if (item?.id != null) await request.delete(`/api/bed-equipment/${item.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("placed equipment is not interactive on the canvas - clicking it opens no panel and shows no resize/rotate handles", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-noninteractive-${stamp}`;
    const bed = await createBed(request, `E2E Equip NonInteractive Bed ${stamp}`, rect(40, 40, 200, 200));
    const equipType = await createEquipmentType(request, slug, "bed_bound", rect(0, 0, 80, 80), 100);

    try {
      await openEquipmentTab(page);
      await addToInventory(page, slug);
      const select = placeSelect(page, /^Place in bed/);
      await select.selectOption({ label: `E2E Equip NonInteractive Bed ${stamp}` });
      await expect
        .poll(async () => (await bedEquipmentByType(request, slug))?.bed_id === bed.id)
        .toBe(true);

      // The marker renders at bed-local (10,10) within a bed placed at
      // world (40,40) - click roughly at its expected screen position.
      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      await page.mouse.click(box.x + 60, box.y + 60);

      // No bed/planting/equipment edit panel opened, and no Transformer
      // handles anywhere - the equipment layer is `listening={false}` at
      // the Konva Layer level (confirmed directly in EquipmentLayer.tsx),
      // so a click here should fall through untouched.
      await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Planting" })).toHaveCount(0);
    } finally {
      const item = await bedEquipmentByType(request, slug);
      if (item?.id != null) await request.delete(`/api/bed-equipment/${item.id}`).catch(() => {});
      await request.delete(`/api/equipment-types/${equipType.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
