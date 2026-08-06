import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #91 ("Remove the close ('X') button from the
 * 'Edit garden' panel") - a small DOM-absence + tab-switching check the
 * ticket's own "How to test" steps ask for directly.
 */

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("GardenPanel has no close button (#91)", () => {
  test("the Garden tab panel has no 'Close' button, and switching tabs away from it still works", async ({ page }) => {
    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);

    await page.getByRole("tab", { name: "Garden" }).click();
    // Either the empty-state "Set up garden" form or the full edit form,
    // depending on whether a Garden already exists in this environment -
    // either way, no aria-label="Close" button should exist anywhere in
    // that panel (unlike BedPanel/EquipmentPanel/PlantingPanel, which all
    // still have one).
    const gardenHeading = page.getByRole("heading", { name: /Set up garden|Edit garden/ });
    await expect(gardenHeading.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);

    // Switching tabs still works via the tab switcher itself.
    await page.getByRole("tab", { name: "Objects" }).click();
    await expect(page.getByRole("button", { name: "Add bed" })).toBeVisible();
  });
});
