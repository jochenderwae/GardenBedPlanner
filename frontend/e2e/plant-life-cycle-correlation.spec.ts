import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #118 ("Life cycle years should not be
 * independent of Life Cycle") - the implementer's own outcome comment
 * only verifies build/lint/vitest, no interactive check of the actual
 * two-way sync `LifeCycleFields.tsx` implements. Drives one continuous
 * flow through the plant-detail page covering both directions of the
 * correlation plus the combined-undo requirement.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail life_cycle / life_cycle_years correlation (#118)", () => {
  test("selecting a life cycle auto-fills/clears years, typing years infers the life cycle, both commit together", async ({
    page,
    request,
  }) => {
    const slug = `e2e-life-cycle-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Life Cycle Plant");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Life Cycle Plant" })).toBeVisible();

      const lifeCycleSelect = page.getByRole("combobox", { name: "Life cycle" });
      const yearsInput = page.getByRole("spinbutton", { name: "Life cycle years (productive lifespan)" });

      // Starting state: both unset.
      await expect(lifeCycleSelect).toHaveValue("");
      await expect(yearsInput).toHaveValue("");

      // Selecting Annual auto-fills years to 1 and persists both together.
      await lifeCycleSelect.selectOption("annual");
      await expect(yearsInput).toHaveValue("1");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle, {
          message: "selecting Annual never persisted life_cycle",
        })
        .toBe("annual");
      let detail = await (await request.get(`/api/plants/${slug}`)).json();
      expect(detail.life_cycle_years).toBe(1);

      // Switching to Biennial updates the auto-filled years from 1 to 2.
      await lifeCycleSelect.selectOption("biennial");
      await expect(yearsInput).toHaveValue("2");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle_years, {
          message: "switching to Biennial never updated the persisted years",
        })
        .toBe(2);
      detail = await (await request.get(`/api/plants/${slug}`)).json();
      expect(detail.life_cycle).toBe("biennial");

      // Switching to Perennial clears the stale fixed year count (2) back
      // to empty rather than leaving it lingering.
      await lifeCycleSelect.selectOption("perennial");
      await expect(yearsInput).toHaveValue("");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle_years, {
          message: "switching to Perennial never cleared the stale years value",
        })
        .toBeNull();
      detail = await (await request.get(`/api/plants/${slug}`)).json();
      expect(detail.life_cycle).toBe("perennial");

      // Typing a real 3+ year count for a perennial is free-form and left
      // alone (not cleared/overridden).
      await yearsInput.fill("7");
      await yearsInput.blur();
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle_years, {
          message: "a free-form perennial year count never persisted",
        })
        .toBe(7);
      detail = await (await request.get(`/api/plants/${slug}`)).json();
      expect(detail.life_cycle).toBe("perennial"); // unchanged - 7 doesn't imply a different cycle than what's already set

      // Typing years=1 directly (life cycle currently perennial) infers
      // Annual - the reverse direction of the correlation.
      await yearsInput.fill("1");
      await yearsInput.blur();
      await expect(lifeCycleSelect).toHaveValue("annual");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle, {
          message: "typing years=1 never inferred Annual",
        })
        .toBe("annual");

      // Typing years=2 directly infers Biennial.
      await yearsInput.fill("2");
      await yearsInput.blur();
      await expect(lifeCycleSelect).toHaveValue("biennial");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle, {
          message: "typing years=2 never inferred Biennial",
        })
        .toBe("biennial");

      // Typing years=5 (>=3) infers Perennial.
      await yearsInput.fill("5");
      await yearsInput.blur();
      await expect(lifeCycleSelect).toHaveValue("perennial");
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle, {
          message: "typing years=5 never inferred Perennial",
        })
        .toBe("perennial");

      // Clearing years back to empty doesn't imply/change any life cycle -
      // the existing "perennial" is left alone, not reset to unset.
      await yearsInput.fill("");
      await yearsInput.blur();
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle_years, {
          message: "clearing years never persisted as null",
        })
        .toBeNull();
      detail = await (await request.get(`/api/plants/${slug}`)).json();
      expect(detail.life_cycle).toBe("perennial"); // unchanged, not cleared

      // Undo reverts BOTH fields together as one step (they commit as a
      // single combined patch) - confirmed by checking both the UI and the
      // API land back on the state right before this last clear.
      await page.getByRole("button", { name: "Undo" }).click();
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).life_cycle_years, {
          message: "Undo never restored the prior life_cycle_years value",
        })
        .toBe(5);
      const afterUndo = await (await request.get(`/api/plants/${slug}`)).json();
      expect(afterUndo.life_cycle).toBe("perennial");
      await expect(yearsInput).toHaveValue("5");
      await expect(lifeCycleSelect).toHaveValue("perennial");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
