import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #83 ("Second confirm dialog + error handling
 * for bed deletion - frontend") - the frontend counterpart of #82's
 * backend cascade-delete support. Root cause was `BedPanel.tsx`'s delete
 * mutation having no `onError` handler at all, silently swallowing the
 * backend's correct `409`; verifying that's actually fixed needs driving
 * the real dialog-to-dialog flow, which no typecheck/Vitest test touches
 * (the ticket has no comments yet, i.e. no implementer outcome note to
 * quote, but the same "no browser automation" gap every other canvas-panel
 * ticket this session has had applies here too).
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

async function openBedPanel(page: Page, bedCenterX: number, bedCenterY: number): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Beds" }).click();
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  await page.mouse.click(box.x + bedCenterX, box.y + bedCenterY);
  await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
}

test.describe("Bed delete confirm + cascade dialog + error handling (#83)", () => {
  test("deleting an occupied bed opens a cascade-confirm dialog; confirming deletes the bed and its planting", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Cascade Confirm Bed", rect(200, 200, 200, 200));
    const slug = `e2e-cascade-confirm-plant-${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: "E2E Cascade Confirm Plant", botanical_name: "Testus e2eus" },
    });
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
      await openBedPanel(page, 300, 300); // bed center: world (200,200)+80/2 offset... center of 200x200 bed

      await page.getByRole("button", { name: "Delete bed" }).click();
      const firstDialog = page.getByRole("alertdialog");
      await expect(firstDialog).toBeVisible();
      await expect(firstDialog.getByRole("heading", { name: /Delete bed .*E2E Cascade Confirm Bed/ })).toBeVisible();
      await firstDialog.getByRole("button", { name: "Delete bed" }).click();

      const cascadeDialog = page.getByRole("alertdialog");
      await expect(cascadeDialog).toBeVisible();
      await expect(cascadeDialog.getByRole("heading", { name: /still has plantings or equipment/ })).toBeVisible();

      await cascadeDialog.getByRole("button", { name: /Delete bed and its plantings\/equipment/ }).click();

      await expect.poll(async () => (await request.get(`/api/beds/${bed.id}`)).status()).toBe(404);
      expect((await request.get(`/api/plantings/${planting.id}`)).status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("canceling the cascade dialog leaves the bed and its planting untouched", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Cascade Cancel Bed", rect(200, 200, 200, 200));
    const slug = `e2e-cascade-cancel-plant-${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: "E2E Cascade Cancel Plant", botanical_name: "Testus e2eus" },
    });
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
      await openBedPanel(page, 300, 300);

      await page.getByRole("button", { name: "Delete bed" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete bed" }).click();

      const cascadeDialog = page.getByRole("alertdialog");
      await expect(cascadeDialog.getByRole("heading", { name: /still has plantings or equipment/ })).toBeVisible();
      await cascadeDialog.getByRole("button", { name: "Cancel" }).click();

      await expect(cascadeDialog).not.toBeVisible();
      // Bed and planting both survive, and the panel is still showing this
      // bed (not silently closed/navigated away).
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
      expect((await request.get(`/api/beds/${bed.id}`)).status()).toBe(200);
      expect((await request.get(`/api/plantings/${planting.id}`)).status()).toBe(200);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a non-409 delete error shows an inline message instead of failing silently", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Delete Error Bed", rect(200, 200, 80, 80));

    try {
      await openBedPanel(page, 240, 240); // 80x80 bed center

      await page.getByRole("button", { name: "Delete bed" }).click();
      const firstDialog = page.getByRole("alertdialog");
      await expect(firstDialog).toBeVisible();

      // Delete the bed out from under the UI via the API directly, right
      // before confirming - the panel's own eventual DELETE call will now
      // 404 (a real, non-409 error) instead of succeeding. cascade=true:
      // every bed auto-generates a background prepare_bed Action the
      // moment it's created (#192), which 409s a plain delete even for a
      // bed with no real plantings/equipment (#219) - without cascade this
      // pre-delete wouldn't actually remove the bed, and the scenario this
      // test constructs (a genuine non-409 404) would never happen.
      await request.delete(`/api/beds/${bed.id}?cascade=true`);

      await firstDialog.getByRole("button", { name: "Delete bed" }).click();

      // A 404 must surface as BedPanel's own inline error text (the
      // `ApiError`'s own message, e.g. "DELETE /api/beds/72 failed: 404" -
      // see client.ts's apiFetch), not the cascade-confirm dialog (that's
      // 409-specific) and not silence.
      await expect(page.getByText(/failed: 404/i)).toBeVisible();
      await expect(page.getByRole("alertdialog").getByRole("heading", { name: /still has plantings or equipment/ })).toHaveCount(
        0,
      );
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
