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
 * always visible - each test below expands it first. A further #237 layer
 * (found while re-running this spec, not covered by #213's own "3 specs
 * updated" list) - each tri-state field is *also* its own click-to-edit
 * `InlineEditableField`: collapsed, a `<button aria-label="Edit <label>">`
 * showing the Yes/No/Unknown display text; clicking it swaps to a real
 * `<select aria-label="<label>">` that commits immediately on change.
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

async function editSelect(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: `Edit ${label}` }).click();
  return page.getByRole("combobox", { name: label });
}

test.describe("Plant-detail sowing tri-state fields (#197)", () => {
  test("a plant with real values shows the correct state for each field", async ({ page, request }) => {
    const slug = `e2e-sowing-flags-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Sowing Flags Plant", { sow_indoors: true, sow_direct: false, needs_thinning: true });

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Sowing Flags Plant" })).toBeVisible();
      await page.getByRole("button", { name: "Show more details" }).click();

      await expect(page.getByRole("button", { name: "Edit Sow indoors" })).toContainText("Yes");
      await expect(page.getByRole("button", { name: "Edit Sow direct" })).toContainText("No");
      await expect(page.getByRole("button", { name: "Edit Needs thinning" })).toContainText("Yes");

      await expect(await editSelect(page, "Sow indoors")).toHaveValue("true");
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

      // Collapsed display text for an unset tristate reads the field's own
      // placeholder ("—"), not "No" - the whole point of #177's tri-state
      // convention.
      for (const label of ["Sow indoors", "Sow direct", "Needs thinning"]) {
        await expect(page.getByRole("button", { name: `Edit ${label}` })).not.toContainText(/^(Yes|No)$/);
        await expect(await editSelect(page, label)).toHaveValue("");
      }
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

      const sowIndoors = await editSelect(page, "Sow indoors");
      await sowIndoors.selectOption("true");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).sow_indoors, {
          message: "setting Sow indoors to Yes never persisted",
        })
        .toBe(true);
      // A select's change commits and collapses back immediately.
      await expect(page.getByRole("button", { name: "Edit Sow indoors" })).toContainText("Yes");

      // Explicitly setting to "No" persists a real `false`, not just
      // clearing back to null - the important distinction #177's data
      // convention draws (unset means "not extracted", false here means a
      // deliberate user correction).
      const sowIndoorsAgain = await editSelect(page, "Sow indoors");
      await sowIndoorsAgain.selectOption("false");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).sow_indoors, {
          message: "setting Sow indoors to No never persisted as a real false",
        })
        .toBe(false);

      // And back to Unknown clears it to null.
      const sowIndoorsOnceMore = await editSelect(page, "Sow indoors");
      await sowIndoorsOnceMore.selectOption("");
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
