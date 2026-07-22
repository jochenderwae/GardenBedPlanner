import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #139 ("Water needs input: numeric mm/week
 * field with unit in label") - per the implementer's own outcome comment,
 * this was already fixed by a same-day hotfix commit, verified only at
 * build/lint/vitest level (no interactive check of the actual rendered
 * field). Confirms the number input on the plant-detail page really does
 * carry the unit in its label and round-trips a real value through a real
 * PATCH.
 */

async function createPlant(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  waterNeeds: number | null,
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", water_needs_mm_per_week: waterNeeds },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail water needs numeric field (#139)", () => {
  test("renders with the unit in its label, shows the existing value, and edits persist a real number", async ({
    page,
    request,
  }) => {
    const slug = `e2e-water-needs-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Water Needs Plant", 25.4);

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Water Needs Plant" })).toBeVisible();

      const waterNeedsInput = page.getByRole("spinbutton", { name: "Water needs (mm/week)" });
      await expect(waterNeedsInput).toBeVisible();
      await expect(waterNeedsInput).toHaveValue("25.4");

      await waterNeedsInput.fill("38.1");
      await waterNeedsInput.blur();

      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).water_needs_mm_per_week, {
          message: "editing the water needs field never persisted the new value",
        })
        .toBe(38.1);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant with no water needs value shows an empty input, not a stray 0 or null text", async ({
    page,
    request,
  }) => {
    const slug = `e2e-water-needs-empty-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Water Needs Empty Plant", null);

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Water Needs Empty Plant" })).toBeVisible();

      const waterNeedsInput = page.getByRole("spinbutton", { name: "Water needs (mm/week)" });
      await expect(waterNeedsInput).toHaveValue("");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
