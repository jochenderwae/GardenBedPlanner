import { test, expect, type Page } from "@playwright/test";

/**
 * Keyboard-only coverage for #144 ("Replace hand-rolled AddBedForm/
 * AddPlantForm/PlantPicker overlays with Dialog primitive") - exactly the
 * "Verification" section the ticket itself calls out as needing a
 * tester/manual pass (focus trap, Escape-to-close, focus return), which
 * `npm run build`'s typecheck can't exercise and jsdom/Vitest has no real
 * focus-trap/keyboard-navigation semantics for either. Real headless
 * Chromium via Playwright against the local dev server.
 *
 * No backend data dependency for the AddBedForm/AddPlantForm cases beyond
 * dismissing the "start with the example garden?" onboarding prompt that
 * shows up (as its own, correctly-implemented `alertdialog`) whenever the
 * beds table is empty - see `dismissOnboardingIfPresent` below. The
 * PlantPicker case needs at least one real Plant row to search for, so
 * that test seeds one via the API and cleans it up after.
 *
 * Not asserting `aria-modal="true"` on the two Dialog-based forms: probed
 * the real DOM and confirmed Base UI's `Dialog.Popup` doesn't set that
 * attribute here at all (achieves modality via `aria-hidden`/inert on
 * background siblings + its own focus trap instead) - true of
 * `alert-dialog.tsx`'s already-"correct" reference usage too (`BedPanel.tsx`'s
 * delete-confirm dialogs), so this isn't a #144 regression, just not how
 * this library expresses modality. The ticket's own "Verification" section
 * doesn't ask for `aria-modal` either - only the focus-trap/Escape/
 * focus-return behavior this file actually checks.
 *
 * ONE REAL BUG, THREE SYMPTOMS (reported back on #144, not fixed here -
 * see this repo's tester agent's boundary: it verifies, it doesn't patch
 * production code): the ticket's "Verification" section requires all three
 * surfaces (Add bed, Add plant, plant picker) to return focus to their
 * trigger button once closed via Escape. In every one of the three, focus
 * instead lands on `<body>` and stays there - confirmed reproducible with
 * settle waits up to 1.5s (ruling out a timing artifact; a genuine
 * focus-guard timing quirk *was* found and worked around separately, see
 * `activeElementStaysWithin` below, so this isn't that). Likely root
 * cause: all three are opened via a plain external `<Button onClick={...}>`
 * + a controlled `open` prop passed straight to `Dialog.Root`/
 * `Popover.Root`, not Base UI's own `Dialog.Trigger`/`Popover.Trigger` -
 * the design spec's own AddBedForm/AddPlantForm text explicitly chose this
 * ("controlled via the existing open-prop pattern, no trigger needed"),
 * which appears to be exactly what breaks Base UI's automatic
 * "restore focus to whatever opened me" behavior (that mechanism seems to
 * key off `Trigger`, not just "whatever had focus when `open` became
 * true"). Fix direction: either switch to real `Trigger` components, or
 * add an explicit `onOpenChange`/`onExitComplete` handler on each that
 * calls `.focus()` on the triggering button by ref. Left all three
 * assertions failing (not skipped) so they stay visible until fixed.
 */

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** Tabs forward `count` times and returns, after each tab, whether
 * `document.activeElement` is still inside `containerSelector` - used to
 * confirm a focus trap holds across more tab presses than the dialog has
 * focusable elements (so a trap that "worked" by accident for one loop
 * around wouldn't be missed). */
async function activeElementStaysWithin(page: Page, containerSelector: string, tabCount: number): Promise<boolean> {
  for (let i = 0; i < tabCount; i++) {
    await page.keyboard.press("Tab");
    // Base UI (like Radix) uses invisible focus-guard sentinel elements
    // just outside the dialog's own subtree to catch focus wrapping past
    // either end, then synchronously redirects it back inside - real, but
    // momentary. Checking `document.activeElement` in the same tick as the
    // keypress can catch that guard mid-flight and misreport an escape
    // that self-corrects a moment later; a short settle avoids that false
    // positive (confirmed via a throwaway probe: with no delay this false-
    // fails on the 5th of ~6 focusable elements every time, with this delay
    // it passes cleanly across multiple full cycles).
    await page.waitForTimeout(50);
    const inside = await page.evaluate((sel) => {
      const container = document.querySelector(sel);
      return !!container && !!document.activeElement && container.contains(document.activeElement);
    }, containerSelector);
    if (!inside) return false;
  }
  return true;
}

test.describe("Dialog/Popover keyboard accessibility (#144)", () => {
  test("Add bed dialog: Tab stays trapped inside; Escape closes it", async ({ page }) => {
    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);
    await page.getByRole("tab", { name: "Beds" }).click();

    const addBedButton = page.getByRole("button", { name: "Add bed" });
    await addBedButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Add bed" })).toBeVisible();

    // Name input has autoFocus - confirm the dialog actually grabbed focus
    // on open (not left on the trigger button behind it).
    await expect(dialog.getByRole("textbox").first()).toBeFocused();

    // More tab presses than the dialog has focusable elements (name,
    // category, shape toggle x2, cancel, create, X close ~= 7) - if the
    // trap didn't hold, this loops past the dialog and out into the page.
    const trapped = await activeElementStaysWithin(page, '[role="dialog"]', 15);
    expect(trapped, "Tab must not be able to move focus out of the open dialog").toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  // See this file's top-of-file doc ("ONE REAL BUG, THREE SYMPTOMS") - focus
  // does not return to the "Add bed" button after Escape, contradicting the
  // ticket's own Verification section. Left failing on purpose.
  test("Add bed dialog: Escape returns focus to the 'Add bed' trigger button", async ({ page }) => {
    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);
    await page.getByRole("tab", { name: "Beds" }).click();

    const addBedButton = page.getByRole("button", { name: "Add bed" });
    await addBedButton.click();
    await page.getByRole("dialog").waitFor();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(addBedButton).toBeFocused();
  });

  test("Add plant dialog on /plants: Tab stays trapped inside; Escape closes it", async ({ page }) => {
    await page.goto("/plants");
    const addPlantButton = page.getByRole("button", { name: "Add plant" });
    await addPlantButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Add plant" })).toBeVisible();

    const trapped = await activeElementStaysWithin(page, '[role="dialog"]', 20);
    expect(trapped, "Tab must not be able to move focus out of the open dialog").toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  // See this file's top-of-file doc ("ONE REAL BUG, THREE SYMPTOMS"). Left
  // failing on purpose.
  test("Add plant dialog on /plants: Escape returns focus to the 'Add plant' trigger button", async ({ page }) => {
    await page.goto("/plants");
    const addPlantButton = page.getByRole("button", { name: "Add plant" });
    await addPlantButton.click();
    await page.getByRole("dialog").waitFor();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(addPlantButton).toBeFocused();
  });

  test("Plant picker popover (Plants tab) opens on click and closes on Escape", async ({ page, request }) => {
    // Seed a plant so the picker's search list has something real to show -
    // not strictly required to test open/close, but keeps the popover in
    // the same state a real user would see it in rather than an
    // empty-results edge case.
    const plantRes = await request.post("/api/plants", {
      data: { common_name: "E2E Picker Plant", botanical_name: "Testus e2eus", slug: "e2e-picker-plant" },
    });
    const created = plantRes.ok() ? await plantRes.json() : null;

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();

      const pickButton = page.getByRole("button", { name: "Pick a plant" });
      await pickButton.click();

      // Base UI's Popover.Popup - deliberately not asserting role="dialog"
      // here since, per the design spec, this is a non-modal Popover, not
      // the same Dialog primitive AddBedForm/AddPlantForm use.
      const searchInput = page.getByPlaceholder(/search/i).first();
      await expect(searchInput).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(searchInput).not.toBeVisible();
    } finally {
      if (created?.slug) {
        await request.delete(`/api/plants/${created.slug}`).catch(() => {});
      }
    }
  });

  // See this file's top-of-file doc ("ONE REAL BUG, THREE SYMPTOMS") - the
  // ticket's Verification section says to repeat the same focus-return
  // check for the plant picker popover too. Left failing on purpose.
  test("Plant picker popover (Plants tab): Escape returns focus to the 'Pick a plant' trigger button", async ({
    page,
    request,
  }) => {
    const plantRes = await request.post("/api/plants", {
      data: { common_name: "E2E Picker Plant 2", botanical_name: "Testus e2eus", slug: "e2e-picker-plant-2" },
    });
    const created = plantRes.ok() ? await plantRes.json() : null;

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();

      const pickButton = page.getByRole("button", { name: "Pick a plant" });
      await pickButton.click();
      await page.getByPlaceholder(/search/i).first().waitFor();

      await page.keyboard.press("Escape");
      await expect(page.getByPlaceholder(/search/i).first()).not.toBeVisible();
      await expect(pickButton).toBeFocused();
    } finally {
      if (created?.slug) {
        await request.delete(`/api/plants/${created.slug}`).catch(() => {});
      }
    }
  });
});
