import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #146 ("Snackbar toast is missing aria-live/
 * role=status") - the implementer's own outcome comment says "No screen
 * reader available in this environment to do the spec's suggested
 * announcement spot-check, so that part of verification still needs a
 * manual/tester pass." A real screen reader still isn't available here
 * either, but this verifies everything short of that: the actual ARIA
 * attributes are present with the right values when a snackbar appears,
 * the message/Undo interaction still works with them in place, and the
 * auto-dismiss timing.
 *
 * #213/#237 update: the plant name is now a click-to-edit
 * InlineEditableField (plain text/button until clicked), not an
 * always-editable textbox - each test below clicks it first to reveal the
 * real input before filling it.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Snackbar accessibility (#146)", () => {
  test("an autosave confirmation renders with role=status and aria-live=polite", async ({ page, request }) => {
    const slug = `e2e-snackbar-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Snackbar Plant");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Snackbar Plant" })).toBeVisible();

      // No snackbar at all before anything is saved - confirms the test
      // below is actually observing a real appearance, not a pre-existing
      // leftover status region.
      await expect(page.locator('[role="status"]')).toHaveCount(0);

      await page.getByRole("button", { name: "E2E Snackbar Plant" }).click();
      const commonNameInput = page.getByRole("textbox", { name: "Common name" });
      await commonNameInput.fill("E2E Snackbar Plant Renamed");
      await commonNameInput.blur();

      const status = page.getByRole("status");
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).toContainText("Saved Common name");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("Undo inside the status region reverts the value and dismisses the snackbar", async ({ page, request }) => {
    const slug = `e2e-snackbar-undo-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Snackbar Undo Plant");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Snackbar Undo Plant" })).toBeVisible();

      await page.getByRole("button", { name: "E2E Snackbar Undo Plant" }).click();
      const commonNameInput = page.getByRole("textbox", { name: "Common name" });
      await commonNameInput.fill("E2E Snackbar Undo Plant Renamed");
      await commonNameInput.blur();

      const status = page.getByRole("status");
      await expect(status).toBeVisible();
      await status.getByRole("button", { name: "Undo" }).click();

      await expect(page.locator('[role="status"]')).toHaveCount(0);
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).common_name, {
          message: "Undo inside the status region never reverted the persisted value",
        })
        .toBe("E2E Snackbar Undo Plant");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("the status region auto-dismisses after its timeout", async ({ page, request }) => {
    const slug = `e2e-snackbar-dismiss-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Snackbar Dismiss Plant");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Snackbar Dismiss Plant" })).toBeVisible();

      await page.getByRole("button", { name: "E2E Snackbar Dismiss Plant" }).click();
      const commonNameInput = page.getByRole("textbox", { name: "Common name" });
      await commonNameInput.fill("E2E Snackbar Dismiss Plant Renamed");
      await commonNameInput.blur();

      await expect(page.getByRole("status")).toBeVisible();
      // DISMISS_MS is 6000 in Snackbar.tsx - generous timeout above that.
      await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 8000 });
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
