import { test, expect } from "@playwright/test";

/**
 * Real-browser coverage for #114 ("Bed Planner layout") - the ticket's own
 * "How to test" section is a mix of "element X doesn't exist"/"element Y is
 * navigable" (which build/typecheck can't confirm, only real DOM inspection
 * can) and a layout-proportions claim ("close to the full available
 * vertical space, not roughly 60%") that needs a real rendered viewport to
 * measure at all.
 */

test.describe("Bed Planner layout (#114)", () => {
  test("no Back button or 'Bed layout' title in the toolbar", async ({ page }) => {
    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();

    await expect(page.getByRole("link", { name: /^back$/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^bed layout$/i })).toHaveCount(0);
  });

  test("the Bed Planner is reachable from the hamburger menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();

    const navLink = page.getByRole("link", { name: "Bed Planner" });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/layout$/);
    await page.locator("canvas").first().waitFor();
  });

  test("the drawing area occupies most of the available viewport height, not ~60%", async ({ page }) => {
    await page.goto("/layout");
    const canvas = page.locator("canvas").first();
    await canvas.waitFor();

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("canvas not visible");
    const viewportSize = page.viewportSize();
    if (!viewportSize) throw new Error("no viewport size");

    const ratio = canvasBox.height / viewportSize.height;
    expect(ratio, `canvas only occupies ${(ratio * 100).toFixed(0)}% of the viewport height`).toBeGreaterThan(0.65);
  });
});
