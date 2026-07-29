import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #172 ("Growth habit rendering needs a key /
 * legend") - the implementer's own outcome comment explicitly left the
 * legend's actual on-screen appearance/toggle behavior unverified (no
 * browser-automation tool available), and no e2e spec touched this
 * component before. Covers the ticket's own "how to test" steps: visible
 * on the layout editor's Plants tab and on the read-only View tab, not on
 * unrelated edit tabs, and lists all 6 shape/label rows (5 known habits +
 * the "Unspecified" fallback, matching `KNOWN_HABITS` order).
 */

const HABIT_LABELS = ["Upright", "Spreading", "Climbing", "Rosette", "Tree", "Unspecified"] as const;

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function gotoLayout(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
}

test.describe("Growth habit shape legend (#172)", () => {
  test("visible and expanded by default on the Plants tab, listing all 6 shape/label rows", async ({ page }) => {
    await gotoLayout(page);
    await page.getByRole("tab", { name: "Plants" }).click();

    const header = page.getByRole("button", { name: "Plant shapes" });
    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute("aria-expanded", "true");

    const list = page.locator("#growth-habit-legend-list");
    await expect(list).toBeVisible();
    for (const label of HABIT_LABELS) {
      await expect(list.getByText(label, { exact: true })).toBeVisible();
    }
    // Exactly one row per label, no duplicates/drift.
    await expect(list.locator("li")).toHaveCount(HABIT_LABELS.length);
  });

  test("collapses and re-expands via its own header button", async ({ page }) => {
    await gotoLayout(page);
    await page.getByRole("tab", { name: "Plants" }).click();

    const header = page.getByRole("button", { name: "Plant shapes" });
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#growth-habit-legend-list")).toHaveCount(0);

    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#growth-habit-legend-list")).toBeVisible();
  });

  test("not shown on the Garden/Beds/Equipment edit tabs - only Plants", async ({ page }) => {
    await gotoLayout(page);

    for (const tabName of ["Garden", "Beds", "Equipment"]) {
      await page.getByRole("tab", { name: tabName }).click();
      await expect(page.getByRole("button", { name: "Plant shapes" }), `legend shown on the ${tabName} tab`).toHaveCount(0);
    }
  });

  test("visible on the read-only View tab too", async ({ page }) => {
    await gotoLayout(page);
    await page.getByRole("radio", { name: "View" }).click();

    const header = page.getByRole("button", { name: "Plant shapes" });
    await expect(header).toBeVisible();
    const list = page.locator("#growth-habit-legend-list");
    await expect(list).toBeVisible();
    for (const label of HABIT_LABELS) {
      await expect(list.getByText(label, { exact: true })).toBeVisible();
    }
  });
});
