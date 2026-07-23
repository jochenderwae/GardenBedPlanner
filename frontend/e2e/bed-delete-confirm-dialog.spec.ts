import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #81 ("Replace the 'delete bed' browser
 * confirm() popup with the frontend toolkit's own dialog component") - no
 * implementer outcome comment. `bed-delete-cascade-confirm.spec.ts` (#83)
 * already covers the *occupied*-bed path (first dialog -> cascade dialog
 * chain) in depth, but only tests canceling the *second* (cascade) dialog,
 * never the first one, and never the plain empty-bed direct-delete path
 * this ticket's own "how to test" describes (no second dialog involved at
 * all). This fills that gap.
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

test.describe("Bed delete confirm dialog - the styled AlertDialog, not native confirm() (#81)", () => {
  test("the dialog names the bed, warns it can't be undone, and is a real alertdialog role - not a native confirm()", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Delete Dialog Bed", rect(200, 200, 80, 80));

    try {
      await openBedPanel(page, 240, 240);

      // If this were still window.confirm(), Playwright would need a
      // page.on("dialog") handler or the click would hang waiting on a
      // native browser dialog it can't see - a plain click + role-based
      // assertion below only works at all because it's a real in-DOM
      // AlertDialog.
      await page.getByRole("button", { name: "Delete bed" }).click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: 'Delete bed "E2E Delete Dialog Bed"?' })).toBeVisible();
      await expect(dialog.getByText("This removes the bed and its layout permanently")).toBeVisible();
      await expect(dialog.getByText(/can't be undone/i)).toBeVisible();
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("canceling the first dialog leaves the bed completely untouched", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Delete Dialog Cancel Bed", rect(200, 200, 80, 80));

    try {
      await openBedPanel(page, 240, 240);

      await page.getByRole("button", { name: "Delete bed" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await expect(dialog).not.toBeVisible();
      // The panel is still showing this same bed (not silently closed).
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
      const stillThere = await request.get(`/api/beds/${bed.id}`);
      expect(stillThere.status()).toBe(200);
      expect((await stillThere.json()).name).toBe("E2E Delete Dialog Cancel Bed");
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("confirming deletes an empty bed directly, with no second (cascade) dialog", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Delete Dialog Confirm Bed", rect(200, 200, 80, 80));

    try {
      await openBedPanel(page, 240, 240);

      await page.getByRole("button", { name: "Delete bed" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Delete bed" }).click();

      await expect.poll(async () => (await request.get(`/api/beds/${bed.id}`)).status()).toBe(404);
      // No cascade dialog for an empty bed - the delete just succeeds and
      // the panel closes.
      await expect(page.getByRole("alertdialog").getByRole("heading", { name: /still has plantings or equipment/ })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
