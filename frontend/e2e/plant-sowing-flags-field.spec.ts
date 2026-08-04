import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #197 ("Surface sow_indoors/sow_direct/
 * needs_thinning on the plant details page") - the implementer's own
 * outcome comment reports build/lint/vitest passing only, no interactive
 * check of the actual rendered tri-state fields. Same pattern as
 * `plant-water-needs-field.spec.ts` (#139). Confirms all three fields
 * render as genuine tri-state (Yes/No/Unknown, not defaulting an unset
 * `null` to "No" - per #177's own "true-or-null, never a derived false"
 * data convention) and that edits persist through a real PATCH.
 *
 * #213/#237 update: these three fields are "secondary" tier in #237's
 * Option A layout (technical/niche, not everyday-relevant), so they now
 * render collapsed behind the "Show more details" disclosure rather than
 * always visible - each test below expands it first.
 */

async function createPlant(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  overrides: Partial<{ sow_indoors: boolean | null; sow_direct: boolean | null; needs_thinning: boolean | null }>,
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", ...overrides },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail sowing tri-state fields (#197)", () => {
  test("a plant with real values shows the correct state for each field", async ({ page, request }) => {
    const slug = `e2e-sowing-flags-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Sowing Flags Plant", { sow_indoors: true, sow_direct: false, needs_thinning: true });

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Sowing Flags Plant" })).toBeVisible();
      await page.getByRole("button", { name: "Show more details" }).click();

      await expect(page.getByLabel("Sow indoors")).toHaveValue("true");
      await expect(page.getByLabel("Sow direct")).toHaveValue("false");
      await expect(page.getByLabel("Needs thinning")).toHaveValue("true");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant with none of the three set renders Unknown, not No", async ({ page, request }) => {
    const slug = `e2e-sowing-flags-unset-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Sowing Flags Unset Plant", {});

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Sowing Flags Unset Plant" })).toBeVisible();
      await page.getByRole("button", { name: "Show more details" }).click();

      // Konva-free, this is a plain HTML <select> - value "" maps to the
      // "Unknown" option per FieldInput.tsx's own tristate branch.
      await expect(page.getByLabel("Sow indoors")).toHaveValue("");
      await expect(page.getByLabel("Sow direct")).toHaveValue("");
      await expect(page.getByLabel("Needs thinning")).toHaveValue("");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("editing a field to Yes/No/Unknown persists a real PATCH, distinguishing false from null", async ({ page, request }) => {
    const slug = `e2e-sowing-flags-edit-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Sowing Flags Edit Plant", {});

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Sowing Flags Edit Plant" })).toBeVisible();
      await page.getByRole("button", { name: "Show more details" }).click();

      const sowIndoors = page.getByLabel("Sow indoors");
      await sowIndoors.selectOption("true");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).sow_indoors, {
          message: "setting Sow indoors to Yes never persisted",
        })
        .toBe(true);

      // Explicitly setting to "No" persists a real `false`, not just
      // clearing back to null - the important distinction #177's data
      // convention draws (unset means "not extracted", false here means a
      // deliberate user correction).
      await sowIndoors.selectOption("false");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).sow_indoors, {
          message: "setting Sow indoors to No never persisted as a real false",
        })
        .toBe(false);

      // And back to Unknown clears it to null.
      await sowIndoors.selectOption("");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).sow_indoors, {
          message: "setting Sow indoors back to Unknown never cleared it to null",
        })
        .toBeNull();
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
