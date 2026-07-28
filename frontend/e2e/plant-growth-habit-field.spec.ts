import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #171 ("Add growth habit to plant details
 * screen") - the implementer's own outcome comment reports build/lint/
 * vitest passing only, no interactive check of the actual rendered field.
 * Same pattern as `plant-water-needs-field.spec.ts` (#139).
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

      const growthHabitInput = page.getByLabel("Growth habit");
      await expect(growthHabitInput).toBeVisible();
      await expect(growthHabitInput).toHaveValue("spreading");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant with no growth_habit set degrades gracefully - an empty field, not a crash", async ({ page, request }) => {
    const slug = `e2e-growth-habit-empty-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growth Habit Empty Plant", null);

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growth Habit Empty Plant" })).toBeVisible();

      const growthHabitInput = page.getByLabel("Growth habit");
      await expect(growthHabitInput).toBeVisible();
      await expect(growthHabitInput).toHaveValue("");
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

      const growthHabitInput = page.getByLabel("Growth habit");
      await growthHabitInput.fill("climbing");
      await growthHabitInput.blur();

      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).growth_habit, {
          message: "editing the growth habit field never persisted",
        })
        .toBe("climbing");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
