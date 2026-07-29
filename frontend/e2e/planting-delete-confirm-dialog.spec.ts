import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #84 ("Replace the 'remove planting' browser
 * confirm() popup with the frontend toolkit's own dialog component") -
 * the confirm-and-delete path for a planting is already exercised by
 * `planting-click-to-edit.spec.ts` (#86) and the same `AlertDialog`
 * pattern's cancel path is exercised for *beds* by
 * `bed-delete-cascade-confirm.spec.ts` (#83) - this fills the one gap
 * neither covers: canceling a planting's own remove-confirm dialog leaves
 * it untouched, plus a direct check of the dialog's title/description
 * text (naming the specific plant, warning it can't be undone) per the
 * ticket's own step 2.
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

test.describe("Planting remove-confirm dialog is the app's own AlertDialog, not native confirm() (#84)", () => {
  test("the dialog names the plant and warns it can't be undone; canceling leaves the planting untouched", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Planting Cancel Bed", rect(200, 200, 200, 200));
    const slug = `e2e-planting-cancel-plant-${Date.now()}`;
    const commonName = "E2E Planting Cancel Plant";
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
      await page.mouse.click(box.x + 260, box.y + 260);
      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();

      // No native browser confirm() should ever fire - fail loudly if one
      // does (a real regression back to the old behavior this ticket
      // fixes, which this spec would otherwise hang on waiting for a
      // dialog handler that never gets attached).
      let nativeDialogFired = false;
      page.on("dialog", async (dialog) => {
        nativeDialogFired = true;
        await dialog.dismiss();
      });

      await page.getByRole("button", { name: /Remove planting/ }).click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByRole("heading", { name: `Remove ${commonName}?` })).toBeVisible();
      await expect(confirmDialog.getByText(/can't be undone/i)).toBeVisible();

      // --- Cancel: planting must be untouched ---
      await confirmDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(confirmDialog).not.toBeVisible();
      expect((await request.get(`/api/plantings/${planting.id}`)).status()).toBe(200);
      // The edit panel itself is still showing this same planting - the
      // cancel didn't navigate away or close anything else.
      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();

      expect(nativeDialogFired, "a native browser confirm()/dialog fired instead of the app's own AlertDialog").toBe(
        false,
      );

      // --- Then actually confirm it, for completeness of this ticket's
      // own step 4 (the happy path itself is already covered in depth by
      // #86's spec, so this is a light final check, not a full repeat).
      await page.getByRole("button", { name: /Remove planting/ }).click();
      await confirmDialog.getByRole("button", { name: /Remove planting/ }).click();
      await expect.poll(async () => (await request.get(`/api/plantings/${planting.id}`)).status()).toBe(404);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
