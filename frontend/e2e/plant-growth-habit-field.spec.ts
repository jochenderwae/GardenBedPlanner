import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #171 ("Add growth habit to plant details
 * screen") - the implementer's own outcome comment reports build/lint/
 * vitest passing only, no interactive check of the actual rendered field.
 * Same pattern as `plant-water-needs-field.spec.ts` (#139).
 *
 * #237 update: this field is now a click-to-edit `InlineEditableField`
 * (`type: "select"`, primary tier - always visible, no "Show more details"
 * expansion needed unlike the secondary-tier tristate fields) - collapsed,
 * it's a `<button aria-label="Edit Growth habit">` showing the display
 * label as plain text; clicking it swaps to a real `<select
 * aria-label="Growth habit">` that commits immediately on change.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string, growthHabit: string | null): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", growth_habit: growthHabit },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail growth habit field (#171)", () => {
  test("a plant with a known growth_habit shows it on the page", async ({ page, request }) => {
    const slug = `e2e-growth-habit-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growth Habit Plant", "spreading");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growth Habit Plant" })).toBeVisible();

      // Collapsed state shows the real display label as plain text.
      await expect(page.getByRole("button", { name: "Edit Growth habit" })).toContainText("Spreading");

      // Clicking it swaps to a real, pre-selected <select>.
      await page.getByRole("button", { name: "Edit Growth habit" }).click();
      await expect(page.getByLabel("Growth habit")).toHaveValue("spreading");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant with no growth_habit set degrades gracefully - a muted placeholder, not a crash", async ({ page, request }) => {
    const slug = `e2e-growth-habit-empty-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growth Habit Empty Plant", null);

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growth Habit Empty Plant" })).toBeVisible();

      const trigger = page.getByRole("button", { name: "Edit Growth habit" });
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.getByLabel("Growth habit")).toHaveValue("");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("editing the growth habit field persists a real PATCH", async ({ page, request }) => {
    const slug = `e2e-growth-habit-edit-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growth Habit Edit Plant", null);

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growth Habit Edit Plant" })).toBeVisible();

      await page.getByRole("button", { name: "Edit Growth habit" }).click();
      // A select's own change *is* the commit (no separate blur step) -
      // InlineEditableField's own documented behavior for type="select".
      await page.getByLabel("Growth habit").selectOption("climbing");

      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).growth_habit, {
          message: "editing the growth habit field never persisted",
        })
        .toBe("climbing");
      // Collapses back to the display-text button, now showing the new value.
      await expect(page.getByRole("button", { name: "Edit Growth habit" })).toContainText("Climbing");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
