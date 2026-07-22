import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #86 ("Clicking a placed plant should open a
 * details/edit popup, not act as delete") - all 4 of the ticket's own "How
 * to test" steps are real click/dblclick/form-edit interactions on the
 * Konva canvas + `PlantingPanel`, which neither a typecheck nor a Vitest/
 * jsdom test can exercise. Overlaps a little with what
 * `keyboard-shortcuts.spec.ts` (#17) and `bed-delete-cascade-confirm.spec.ts`
 * (#83) already cover (a single click opening the panel, the confirm-then-
 * delete flow) - this fills the specific gaps those don't: double-click
 * not silently deleting (the actual root-cause regression this ticket
 * fixes), and editing the panel's own fields actually saving.
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

test.describe("Clicking a placed plant opens its edit panel, not a delete (#86)", () => {
  test("single click and double-click both open the panel; only the explicit confirm-delete button removes the planting", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Planting Click Bed", rect(200, 200, 300, 300));
    const slug = `e2e-planting-click-plant-${Date.now()}`;
    const commonName = "E2E Planting Click Plant";
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    const plantingRes = await request.post("/api/plantings", {
      data: {
        bed_id: bed.id,
        plant_slug: slug,
        placement_type: "individual",
        geometry: rect(40, 40, 40, 40),
        planted_date: null,
        removed_date: null,
      },
    });
    const planting = await plantingRes.json();

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      // Marker center: bed world (200,200) + planting-local center (60,60).
      const markerX = box.x + 260;
      const markerY = box.y + 260;

      // Step 1: single click opens the panel.
      await page.mouse.click(markerX, markerY);
      const panelHeading = page.getByRole("heading", { name: commonName });
      await expect(panelHeading).toBeVisible();

      // Step 2: double-clicking the same marker must NOT delete it - it
      // should still just be the edit panel, and the planting must still
      // exist. Close the panel first so a fresh double-click has to
      // re-select from scratch (proves double-click on the marker itself
      // is what's being exercised, not just an already-open panel).
      await page.getByRole("button", { name: "Close" }).click();
      await expect(panelHeading).toHaveCount(0);
      await page.mouse.dblclick(markerX, markerY);
      await expect(panelHeading).toBeVisible();
      expect((await request.get(`/api/plantings/${planting.id}`)).status(), "double-click deleted the planting").toBe(
        200,
      );

      // Step 3: editing the panel's own fields actually saves.
      await page.getByRole("combobox").selectOption("row");
      await expect
        .poll(async () => (await (await request.get(`/api/plantings/${planting.id}`)).json()).placement_type, {
          message: "placement_type edit from the panel never persisted",
        })
        .toBe("row");

      const plantedDateInput = page.locator('input[type="date"]').first();
      await plantedDateInput.fill("2026-03-15");
      await plantedDateInput.blur();
      await expect
        .poll(async () => (await (await request.get(`/api/plantings/${planting.id}`)).json()).planted_date, {
          message: "planted_date edit from the panel never persisted",
        })
        .toBe("2026-03-15");

      // Step 4: the explicit delete button (with its own confirm dialog,
      // per #83/#84) is what actually removes it.
      await page.getByRole("button", { name: /Remove planting/ }).click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole("button", { name: /Remove planting/ }).click();

      await expect.poll(async () => (await request.get(`/api/plantings/${planting.id}`)).status()).toBe(404);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
