import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #200 ("Minimal UI for irrigation zones
 * (create/assign/view totals)") - all 4 of the ticket's own "How to test"
 * steps are real form-submit/select/click interactions against
 * `EquipmentPanel.tsx`'s new zone-management section, which neither a
 * typecheck nor a Vitest/jsdom test can exercise. The backend CRUD +
 * total-computation itself already has coverage from #36
 * (`backend/tests/test_irrigation_zone_crud.py`) - this spec is purely
 * about the new frontend wiring on top of it.
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

async function openEquipmentPanel(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Equipment" }).click();
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
}

test.describe("Irrigation zone management (#200)", () => {
  test("create a zone, assign a placed emitter, watch the total update, unassign, and confirm unrelated equipment is unaffected", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Zone Bed ${stamp}`, rect(300, 300, 200, 200));
    const zoneName = `E2E Zone ${stamp}`;
    const emitterType = `e2e-emitter-${stamp}`;
    const unrelatedType = `e2e-stake-${stamp}`;
    let zoneId: number | undefined;
    let emitterId: number | undefined;
    let unrelatedId: number | undefined;

    try {
      await openEquipmentPanel(page);

      const zoneSection = page.locator("h3", { hasText: "Irrigation zones" }).locator("..");
      const inventorySection = page.locator("text=Inventory (unassigned)").locator("..");
      const placedSection = page.locator("text=Placed").locator("..");

      // --- Create an emitter (with a water rate) and an unrelated item
      // (no water rate) directly via the API to keep the test focused on
      // the zone UI itself rather than re-exercising the create-equipment
      // form (already covered by equipment-inventory-workflow.spec.ts). ---
      const emitterRes = await request.post("/api/bed-equipment", {
        data: { bed_id: null, equipment_type: emitterType, geometry: null, height_cm: null, water_delivery_lph: 120 },
      });
      expect(emitterRes.ok()).toBeTruthy();
      emitterId = (await emitterRes.json()).id;
      const unrelatedRes = await request.post("/api/bed-equipment", {
        data: { bed_id: null, equipment_type: unrelatedType, geometry: null, height_cm: null, water_delivery_lph: null },
      });
      expect(unrelatedRes.ok()).toBeTruthy();
      unrelatedId = (await unrelatedRes.json()).id;

      // Place both on the bed - only *placed* equipment gets a "Zone"
      // selector in the UI.
      await request.patch(`/api/bed-equipment/${emitterId}`, { data: { bed_id: bed.id } });
      await request.patch(`/api/bed-equipment/${unrelatedId}`, { data: { bed_id: bed.id } });
      await page.reload();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Equipment" }).click();

      // --- Step 1: create a new zone from the UI, confirm it appears ---
      await expect(zoneSection.getByText("No zones yet.")).toBeVisible();
      await zoneSection.getByPlaceholder("New zone name").fill(zoneName);
      await zoneSection.getByRole("button", { name: "Add zone" }).click();

      // Anchor the row on its delete button's aria-label rather than the
      // name input's `value` *attribute* - a controlled React input keeps
      // that attribute at whatever it was on first mount rather than
      // syncing it to the live typed value, so it's not a reliable
      // selector once a rename happens later in this file. The delete
      // button's `aria-label` is derived straight from the live `zone.name`
      // prop on every render, so it's always in sync.
      const zoneDeleteButton = zoneSection.getByRole("button", { name: `Delete zone ${zoneName}` });
      await expect(zoneDeleteButton).toBeVisible();
      await expect
        .poll(async () => {
          const zones = (await (await request.get("/api/irrigation-zones")).json()) as { id: number; name: string }[];
          return zones.find((z) => z.name === zoneName)?.id;
        }, { message: "zone never got created server-side" })
        .toBeDefined();
      const zones = (await (await request.get("/api/irrigation-zones")).json()) as { id: number; name: string }[];
      zoneId = zones.find((z) => z.name === zoneName)!.id;

      // ZoneRow's own div is the delete button's direct parent - an XPath
      // walk up one level is unambiguous, unlike a broad div-with-hasText
      // CSS locator which would also match every containing ancestor div
      // up to the whole zoneSection.
      const zoneRow = zoneDeleteButton.locator("xpath=..");
      await expect(zoneRow.locator("input")).toHaveValue(zoneName);
      await expect(zoneRow.getByText("—", { exact: true })).toBeVisible();

      // --- Step 2: assign the placed emitter to the zone, confirm the
      // total updates ---
      // ".flex.flex-col.gap-1" alone also matches the *wrapper* div around
      // every placed item (it shares those same three class tokens plus
      // others) - "rounded px-1 py-1" narrows it down to just one
      // individual item row.
      const emitterRow = placedSection.locator("div.flex.flex-col.gap-1.rounded.px-1.py-1", { hasText: emitterType }).first();
      await emitterRow.getByRole("combobox").selectOption({ label: zoneName });

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${emitterId}`)).json()).zone_id, {
          message: "assigning the emitter to the zone via the select never persisted",
        })
        .toBe(zoneId);
      await expect
        .poll(async () => (await (await request.get(`/api/irrigation-zones/${zoneId}`)).json()).total_water_delivery_lph, {
          message: "zone total never reflected the newly-assigned emitter's water_delivery_lph",
        })
        .toBe(120);
      // The UI's own displayed total (fetched from the zone detail
      // endpoint) should reflect the same 120 L/h, not just the API.
      await expect(zoneRow.getByText("120 L/h", { exact: true })).toBeVisible();

      // --- Step 3: unassign it, confirm the total drops back ---
      await emitterRow.getByRole("combobox").selectOption({ label: "No zone" });

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${emitterId}`)).json()).zone_id, {
          message: "unassigning the emitter via the select never persisted",
        })
        .toBeNull();
      await expect
        .poll(async () => (await (await request.get(`/api/irrigation-zones/${zoneId}`)).json()).total_water_delivery_lph, {
          message: "zone total never dropped back after unassigning its only member",
        })
        .toBeNull();
      await expect(zoneRow.getByText("—", { exact: true })).toBeVisible();

      // --- Step 4: equipment never assigned to any zone is unaffected ---
      const unrelatedRow = placedSection.locator("div.flex.flex-col.gap-1.rounded.px-1.py-1", { hasText: unrelatedType }).first();
      await expect(unrelatedRow.getByRole("combobox")).toHaveValue("");
      const unrelatedAfter = await (await request.get(`/api/bed-equipment/${unrelatedId}`)).json();
      expect(unrelatedAfter.zone_id).toBeNull();
      expect(unrelatedAfter.bed_id).toBe(bed.id);
      await expect(inventorySection.getByText(unrelatedType, { exact: true })).toHaveCount(0);
      await expect(placedSection.getByText(unrelatedType, { exact: true })).toBeVisible();
    } finally {
      if (zoneId != null) await request.delete(`/api/irrigation-zones/${zoneId}`).catch(() => {});
      if (emitterId != null) await request.delete(`/api/bed-equipment/${emitterId}`).catch(() => {});
      if (unrelatedId != null) await request.delete(`/api/bed-equipment/${unrelatedId}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("renaming a zone from the UI persists, and deleting a zone unassigns (not deletes) its member equipment", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Zone Rename Bed ${stamp}`, rect(600, 300, 200, 200));
    const zoneName = `E2E Rename Zone ${stamp}`;
    const renamedName = `E2E Renamed Zone ${stamp}`;
    const equipmentType = `e2e-zone-member-${stamp}`;
    let zoneId: number | undefined;
    let equipmentId: number | undefined;

    try {
      const zoneRes = await request.post("/api/irrigation-zones", { data: { name: zoneName, notes: null } });
      expect(zoneRes.ok()).toBeTruthy();
      zoneId = (await zoneRes.json()).id;

      const equipRes = await request.post("/api/bed-equipment", {
        data: { bed_id: bed.id, equipment_type: equipmentType, geometry: null, height_cm: null, water_delivery_lph: 40 },
      });
      expect(equipRes.ok()).toBeTruthy();
      equipmentId = (await equipRes.json()).id;
      await request.patch(`/api/bed-equipment/${equipmentId}`, { data: { zone_id: zoneId } });

      await openEquipmentPanel(page);
      const zoneSection = page.locator("h3", { hasText: "Irrigation zones" }).locator("..");
      const zoneRow = zoneSection.getByRole("button", { name: `Delete zone ${zoneName}` }).locator("xpath=..");
      const zoneNameInput = zoneRow.locator("input");
      await expect(zoneNameInput).toHaveValue(zoneName);

      // Rename inline (commits on blur, per ZoneRow's own implementation).
      await zoneNameInput.fill(renamedName);
      await zoneNameInput.blur();

      await expect
        .poll(async () => (await (await request.get(`/api/irrigation-zones/${zoneId}`)).json()).name, {
          message: "renaming the zone via the inline input never persisted",
        })
        .toBe(renamedName);

      // Delete the zone from the UI.
      await page.getByRole("button", { name: `Delete zone ${renamedName}` }).click();

      await expect(page.getByRole("button", { name: `Delete zone ${renamedName}` })).toHaveCount(0);
      expect((await request.get(`/api/irrigation-zones/${zoneId}`)).status()).toBe(404);

      // Member equipment survives, just unassigned - not cascade-deleted.
      const equipAfter = await (await request.get(`/api/bed-equipment/${equipmentId}`)).json();
      expect(equipAfter.zone_id).toBeNull();
      expect(equipAfter.bed_id).toBe(bed.id);
      zoneId = undefined; // already deleted, skip in finally
    } finally {
      if (zoneId != null) await request.delete(`/api/irrigation-zones/${zoneId}`).catch(() => {});
      if (equipmentId != null) await request.delete(`/api/bed-equipment/${equipmentId}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
