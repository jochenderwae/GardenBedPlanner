import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #123 ("Pest interactions should be displayed
 * as columns") - the implementer's own outcome comment explicitly leaves
 * the Enter-to-add interaction for the tester role to confirm visually.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail pest interactions columns (#123)", () => {
  test("existing entries render in the correct column, typing + Enter adds one and clears the input", async ({
    page,
    request,
  }) => {
    const slug = `e2e-pest-interactions-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Pest Interactions Plant");

    try {
      await request.post(`/api/plants/${slug}/pest-interactions`, {
        data: { interaction_type: "attracts", pest_or_insect: "ladybugs", notes: null },
      });
      await request.post(`/api/plants/${slug}/pest-interactions`, {
        data: { interaction_type: "repels", pest_or_insect: "aphids", notes: null },
      });
      await request.post(`/api/plants/${slug}/pest-interactions`, {
        data: { interaction_type: "vulnerable_to", pest_or_insect: "cutworms", notes: null },
      });

      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Pest Interactions Plant" })).toBeVisible();

      const table = page.locator("table", { has: page.getByRole("columnheader", { name: "Attracts" }) });
      await expect(table.getByRole("columnheader", { name: "Attracts" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Repels" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Vulnerable to" })).toBeVisible();

      // Each existing entry appears - and specifically in its own column,
      // not just "somewhere in the table" - checked by scoping to the
      // <td> under each column header via nth-child position.
      const attractsCell = table.locator("td").nth(0);
      const repelsCell = table.locator("td").nth(1);
      const vulnerableCell = table.locator("td").nth(2);
      await expect(attractsCell.getByText("ladybugs")).toBeVisible();
      await expect(repelsCell.getByText("aphids")).toBeVisible();
      await expect(vulnerableCell.getByText("cutworms")).toBeVisible();
      await expect(attractsCell.getByText("aphids")).toHaveCount(0);
      await expect(attractsCell.getByText("cutworms")).toHaveCount(0);

      // Typing + Enter adds directly, no separate Add button.
      const attractsInput = attractsCell.getByPlaceholder("e.g. aphids");
      await attractsInput.fill("bees");
      await attractsInput.press("Enter");

      await expect
        .poll(
          async () =>
            (await (await request.get(`/api/plants/${slug}`)).json()).pest_interactions.filter(
              (p: { pest_or_insect: string }) => p.pest_or_insect === "bees",
            ).length,
          { message: "typing + Enter in the Attracts column never persisted a new pest interaction" },
        )
        .toBe(1);
      await expect(attractsCell.getByText("bees", { exact: true })).toBeVisible();
      // Input clears itself after a successful add.
      await expect(attractsInput).toHaveValue("");

      const afterAdd = await (await request.get(`/api/plants/${slug}`)).json();
      const added = afterAdd.pest_interactions.find((p: { pest_or_insect: string }) => p.pest_or_insect === "bees");
      expect(added.interaction_type).toBe("attracts");

      // Remove works and only removes the targeted entry.
      await attractsCell.getByRole("button", { name: "Remove attracts pest interaction" }).first().click();
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).pest_interactions.length, {
          message: "removing a pest interaction entry never persisted",
        })
        .toBe(3);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("adding to different columns in sequence keeps each one's own draft independent", async ({
    page,
    request,
  }) => {
    const slug = `e2e-pest-interactions-multi-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Pest Interactions Multi Plant");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Pest Interactions Multi Plant" })).toBeVisible();

      const table = page.locator("table", { has: page.getByRole("columnheader", { name: "Attracts" }) });
      const inputs = table.getByPlaceholder("e.g. aphids");
      await inputs.nth(0).fill("bees");
      await inputs.nth(1).fill("aphids");
      await inputs.nth(2).fill("slugs");

      await inputs.nth(1).press("Enter"); // add Repels first, out of order
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).pest_interactions.length, {
          message: "the Repels column entry never persisted",
        })
        .toBe(1);

      // The other two columns' drafts (not yet submitted) must be untouched
      // by the Repels submission.
      await expect(inputs.nth(0)).toHaveValue("bees");
      await expect(inputs.nth(2)).toHaveValue("slugs");

      await inputs.nth(0).press("Enter");
      await inputs.nth(2).press("Enter");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).pest_interactions.length, {
          message: "not all 3 columns' entries persisted",
        })
        .toBe(3);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
