import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #179 ("GardenPanel's unconditional autoFocus
 * steals keyboard focus every time View mode switches back to Edit") -
 * found by `tester` while writing #143's own toggle-group coverage, now
 * fixed. The fix's own outcome comment explicitly flagged this file's
 * absence and asked for a regression spec here alongside the existing
 * `toggle-group-primitives.spec.ts` the bug was originally found through.
 *
 * Root cause (per the ticket's own repro): `GardenPanel` fully unmounts/
 * remounts every time View mode toggles back to Edit (it's gated on
 * `mode === "mine"`), and its Name input's unconditional `autoFocus`
 * re-fired on every one of those remounts, silently stealing focus away
 * from whatever the user was just interacting with (e.g. the "Edit"
 * toggle button itself), not just on the page's genuine first load. The
 * fix scopes that to a real one-time-per-page-load flag.
 */

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("GardenPanel autoFocus no longer steals focus on every Edit/View remount (#179)", () => {
  test("clicking Edit after View does not move focus into the Garden name input - focus stays on the toggle", async ({
    page,
  }) => {
    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);

    // Default state: Edit mode, Garden tab active (Layout.tsx's own
    // default), same starting point the ticket's own repro describes.
    await expect(page.getByRole("radio", { name: "Edit" })).toBeChecked();

    await page.getByRole("radio", { name: "View" }).click();
    // GardenPanel is gone entirely in View mode.
    await expect(page.locator("label", { hasText: "Name" })).toHaveCount(0);

    const editToggle = page.getByRole("radio", { name: "Edit" });
    await editToggle.click();

    // GardenPanel is back (either "Set up garden" or "Edit garden"
    // branch, whichever this environment is in) - the bug's own repro
    // steps confirm focus jumped into its Name <input> regardless of
    // which branch renders, since both have autoFocus.
    const nameInput = page
      .locator("label")
      .filter({ hasText: "Name" })
      .locator("input")
      .first();
    await expect(nameInput).toBeVisible();

    // The actual regression check: focus must NOT be on that input - it
    // should still be on (or at least not stolen from) the toggle button
    // that was just clicked, matching the WAI-ARIA radiogroup pattern's
    // own focus-management expectation.
    await expect(nameInput).not.toBeFocused();
    await expect(editToggle).toBeFocused();
  });

  test("the empty-state create form's Name input still auto-focuses on the page's genuine first load", async ({
    page,
    request,
  }) => {
    // Only meaningful/reachable when no Garden exists yet - the fix's own
    // guard explicitly preserves this legitimate case, not just removes
    // autoFocus outright.
    const existing = await request.get("/api/garden");
    test.skip(existing.ok(), "a Garden already exists in this environment - the empty-state create form isn't reachable");

    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);

    const nameInput = page
      .locator("label")
      .filter({ hasText: "Name" })
      .locator("input")
      .first();
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeFocused();
  });
});
