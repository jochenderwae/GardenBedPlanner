import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #109 ("Onboarding UI: first-run prompt to
 * seed the example garden") - `OnboardingPrompt.tsx`. The implementer's
 * own outcome comment flagged "no browser-automation available in this
 * environment, so interactive verification stops at [lint/build/vitest]
 * level." This drives all 5 of the ticket's own "How to test" steps
 * directly.
 *
 * Steps 1-3 (prompt appears on an empty database, rejecting dismisses
 * without touching the database, reloading re-prompts since there's no
 * persisted dismissal) run against the real backend - `garden_test` is
 * confirmed empty (no beds, no Garden singleton) at the point this spec
 * runs.
 *
 * Steps 4-5 (accepting seeds and refreshes the canvas; a failed/slow
 * request keeps the dialog open with an inline error) deliberately mock
 * `POST /api/example-garden/seed` via `page.route()` rather than calling
 * the real endpoint - Garden is a permanent singleton with no DELETE
 * endpoint (see garden-panel-no-close-button.spec.ts's own doc for why
 * this matters), so actually seeding for real here would permanently
 * pollute the shared garden_test database and break every other spec's
 * "no garden yet" assumption for good. Mocking lets this verify the
 * frontend's own success/error handling in isolation, which is what
 * OnboardingPrompt.tsx actually owns - the real backend round-trip
 * itself is already covered by #108's own test_example_garden_route.py.
 */

async function gotoLayoutFresh(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
}

test.describe("Onboarding 'seed the example garden?' prompt (#109)", () => {
  test("appears on an empty database, rejecting dismisses it and leaves the database empty, reloading re-prompts", async ({
    page,
    request,
  }) => {
    await gotoLayoutFresh(page);

    // --- Step 1: the prompt appears ---
    const dialogTitle = page.getByText("Start with the example garden?");
    await expect(dialogTitle).toBeVisible();

    // --- Step 2: rejecting dismisses, database stays empty ---
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await expect(dialogTitle).toHaveCount(0);
    const beds = await (await request.get("/api/beds")).json();
    expect(beds, "rejecting the prompt must not create any beds").toEqual([]);
    const gardenRes = await request.get("/api/garden");
    expect(gardenRes.status(), "rejecting the prompt must not create a Garden").toBe(404);

    // --- Step 3: reloading with the database still empty prompts again
    // (onboardingDismissed is plain component state, not persisted) ---
    await gotoLayoutFresh(page);
    await expect(page.getByText("Start with the example garden?")).toBeVisible();
  });

  test("accepting seeds the garden and refreshes the canvas to show the new beds", async ({ page }) => {
    let seedRequested = false;

    await page.route("**/api/example-garden/seed", async (route) => {
      seedRequested = true;
      await route.fulfill({ json: { beds_imported: 1, beds_failed: 0, failures: [] } });
    });
    // The very first GET /api/beds (before seeding) must still show empty
    // so the dialog appears in the first place; every GET *after* the
    // mocked seed succeeds returns one fake bed, so the canvas visibly
    // updates - proving Layout.tsx's own onSeeded invalidation/refetch
    // actually happened, not just that the dialog closed.
    await page.route("**/api/beds", async (route) => {
      if (!seedRequested) {
        await route.fulfill({ json: [] });
        return;
      }
      await route.fulfill({
        json: [
          {
            id: 1,
            name: "Mock Seeded Bed",
            category: null,
            height_cm: 0,
            has_greenhouse: false,
            soil_type: null,
            sun_level: null,
            notes: "",
            border_geometry: { type: "rectangle", x: 40, y: 40, width: 100, height: 100, rotation: 0 },
          },
        ],
      });
    });

    await gotoLayoutFresh(page);
    await expect(page.getByText("Start with the example garden?")).toBeVisible();

    await page.getByRole("button", { name: "Load example garden" }).click();

    await expect(page.getByText("Start with the example garden?")).toHaveCount(0);
    // The canvas actually shows the newly "seeded" bed - the real proof
    // the beds query was invalidated and refetched, not just that the
    // dialog itself closed. Bed names are Konva-drawn (canvas, not real
    // DOM), so getByText can't see them directly - click the bed at its
    // known world position and confirm BedPanel's real <input> shows the
    // mocked name, which only happens if the refetched bed data actually
    // reached the canvas/selection state.
    await page.getByRole("tab", { name: "Beds" }).click();
    const box = await page.locator("canvas").first().boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.click(box.x + 90, box.y + 90); // world (90,90), inside the mock bed's 40,40..140,140 box
    await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
    // toHaveValue reads the live DOM property, not the `value` HTML
    // attribute (which only reflects initial mount state on a controlled
    // input) - the more robust check even though nothing types into this
    // field afterward in this particular test.
    const nameInput = page
      .locator("label")
      .filter({ hasText: "Name" })
      .locator("input")
      .first();
    await expect(nameInput).toHaveValue("Mock Seeded Bed");
  });

  test("a failed seed request keeps the dialog open with an inline error, not closed prematurely", async ({ page }) => {
    await page.route("**/api/example-garden/seed", async (route) => {
      await route.fulfill({ status: 500, json: { detail: "Simulated seed failure" } });
    });

    await gotoLayoutFresh(page);
    await expect(page.getByText("Start with the example garden?")).toBeVisible();

    await page.getByRole("button", { name: "Load example garden" }).click();

    // The dialog stays open (this is the whole point of the plain-Button-
    // not-AlertDialogAction implementation choice), and a real error
    // message renders inline. apiFetch's ApiError carries a generated
    // "<method> <path> failed: <status>" message (see api/client.ts) -
    // not the mocked response body's own "detail" text - and
    // OnboardingPrompt's onError handler shows err.message directly
    // since ApiError is a real Error instance, not falling back to its
    // own generic "Failed to load the example garden." string.
    await expect(page.getByText("Start with the example garden?")).toBeVisible();
    await expect(page.getByText(/POST \/api\/example-garden\/seed failed: 500/)).toBeVisible();

    // Confirms nothing was actually created despite the failed attempt.
    const beds = await page.request.get("/api/beds");
    expect(await beds.json()).toEqual([]);
  });

  test("a slow (still-pending) seed request keeps the button disabled and shows a loading state, doesn't close early", async ({
    page,
  }) => {
    await page.route("**/api/example-garden/seed", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ json: { beds_imported: 0, beds_failed: 0, failures: [] } });
    });

    await gotoLayoutFresh(page);
    await expect(page.getByText("Start with the example garden?")).toBeVisible();

    const loadButton = page.getByRole("button", { name: "Load example garden" });
    await loadButton.click();

    // Mid-flight: the button reads "Loading…" and is disabled, dialog is
    // still open - none of this should have resolved instantly.
    await expect(page.getByRole("button", { name: "Loading…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Loading…" })).toBeDisabled();
    await expect(page.getByText("Start with the example garden?")).toBeVisible();
  });
});
