import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #134 ("Edible parts: dropdown/multi-select
 * instead of free text") - the implementer's outcome comment reports
 * build/lint/vitest passing but no interactive verification of the new
 * checkbox-group `FieldInput.tsx` branch. Drives real checkbox clicks
 * against the plant-detail page and confirms each commits a real PATCH.
 *
 * Updated for #134's own second pass: the checkbox group now lives inside a
 * collapsed popover (`components/ui/popover.tsx`) instead of rendering
 * permanently expanded inline - opens it once (`PopoverTrigger` has
 * `aria-label={field.label}`, i.e. "Edible parts", so this doesn't depend
 * on the trigger's own summary text, which changes as selections change)
 * before the checkbox interactions below, which is otherwise unchanged:
 * Base UI's popover stays open while clicking checkboxes inside it (only
 * outside-click/Escape/another-trigger closes it), so a single open is
 * enough for the whole sequence.
 */

async function createPlant(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  edibleParts: string[],
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", edible_parts: edibleParts },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

function sorted(arr: string[]): string[] {
  return [...arr].sort();
}

test.describe("Plant-detail edible_parts checkbox multiselect (#134)", () => {
  test("reflects existing selection, checking/unchecking commits real PATCHes, undo restores the prior value", async ({
    page,
    request,
  }) => {
    const slug = `e2e-edible-parts-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Edible Parts Plant", ["fruit", "seeds"]);

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Edible Parts Plant" })).toBeVisible();

      // Before opening it: the collapsed trigger shows a comma-joined
      // summary of the current selection, in the options' own declared
      // order (fruit before seeds, even though this plant was created with
      // ["fruit", "seeds"] - not necessarily insertion order).
      await expect(page.getByRole("button", { name: "Edible parts" })).toHaveText("Fruit, Seeds");

      // Checkboxes live inside a collapsed popover now (#134) - open it
      // once before interacting with anything inside.
      await page.getByRole("button", { name: "Edible parts" }).click();

      const fruitCheckbox = page.getByRole("checkbox", { name: "Fruit" });
      const seedsCheckbox = page.getByRole("checkbox", { name: "Seeds" });
      const leavesCheckbox = page.getByRole("checkbox", { name: "Leaves" });
      const rootsCheckbox = page.getByRole("checkbox", { name: "Roots" });

      // Existing value reflected correctly: exactly the 2 preset options
      // checked, everything else unchecked.
      await expect(fruitCheckbox).toBeChecked();
      await expect(seedsCheckbox).toBeChecked();
      await expect(leavesCheckbox).not.toBeChecked();
      await expect(rootsCheckbox).not.toBeChecked();

      // Checking a third option adds it without disturbing the other two.
      // Uses a plain click + a polling assertion rather than Playwright's
      // own `.check()` helper - `.check()`'s built-in "did the state
      // actually change" verification fires immediately after the click and
      // reported a false failure here even though the checkbox reliably
      // ends up checked (confirmed via a throwaway debug spec: a plain
      // click()'s new `checked` state is observable with zero extra wait -
      // this is a fully-controlled checkbox with no local draft state, so
      // there's no real async gap for `.check()` to be tripping over; not
      // an app bug, just this checkbox shape not agreeing with `.check()`'s
      // own verification timing).
      await leavesCheckbox.click();
      await expect(leavesCheckbox).toBeChecked();
      await expect
        .poll(async () => sorted((await (await request.get(`/api/plants/${slug}`)).json()).edible_parts), {
          message: "checking Leaves never persisted",
        })
        .toEqual(["fruit", "leaves", "seeds"]);

      // Unchecking one of the original two removes only that one.
      await fruitCheckbox.click();
      await expect(fruitCheckbox).not.toBeChecked();
      await expect
        .poll(async () => sorted((await (await request.get(`/api/plants/${slug}`)).json()).edible_parts), {
          message: "unchecking Fruit never persisted",
        })
        .toEqual(["leaves", "seeds"]);

      // Unchecking every remaining option leaves a real empty array, not a
      // stuck/stale value.
      await seedsCheckbox.click();
      await leavesCheckbox.click();
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).edible_parts, {
          message: "unchecking every option never persisted an empty array",
        })
        .toEqual([]);
      await expect(fruitCheckbox).not.toBeChecked();
      await expect(seedsCheckbox).not.toBeChecked();
      await expect(leavesCheckbox).not.toBeChecked();

      // Undo (the autosave snackbar's own action) restores the prior value
      // (empty -> back to just ["leaves"], the state right before the last
      // uncheck) and reflects it back in the checkboxes, not just the API.
      // The Undo button sits outside the popover, so clicking it closes the
      // popover first (Base UI's own standard outside-click behavior, not
      // a bug) - unmounting the checkboxes entirely until it's reopened, so
      // re-open it before checking their restored visual state.
      await page.getByRole("button", { name: "Undo" }).click();
      await expect
        .poll(async () => (await (await request.get(`/api/plants/${slug}`)).json()).edible_parts, {
          message: "Undo never restored the prior edible_parts value",
        })
        .toEqual(["leaves"]);
      await page.getByRole("button", { name: "Edible parts" }).click();
      await expect(leavesCheckbox).toBeChecked();
      await expect(fruitCheckbox).not.toBeChecked();
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
