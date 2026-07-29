import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #142 ("Add a shared Input/Select/Textarea
 * primitive") - a pure refactor (10 call sites migrated off a duplicated
 * inline Tailwind class string onto `@/components/ui/input`'s new
 * `Input`/`Select`/`Textarea`), verified by the implementer at build/
 * typecheck level only ("every call site keeps its existing props... this
 * should be a pure refactor with no behavior change" - but with "No
 * visual/interactive verification was possible"). `BedPanel.tsx` alone
 * exercises all three new primitives plus the `numeric` variant in one
 * place (width/length/rotation `Input variant="numeric"`, a plain `Input`
 * for soil type, `Select` for sun level, `Textarea` for notes) - this spec
 * drives real typing/selecting/blurring through each of those and confirms
 * the resulting `PATCH` actually persisted, i.e. the refactor didn't quietly
 * drop an `onChange`/`onBlur`/`value` wire-up along the way.
 *
 * Bed's Name/Category `Input` (plain text variant) already gets real
 * exercise from several other specs in this directory (#14/#66/#70/#144),
 * so this one focuses on what those don't touch: the numeric variant and
 * `Select`/`Textarea`.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function openBedPanel(page: Page, bedName: string): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await page.getByRole("tab", { name: "Beds" }).click();
  await page.locator("canvas").first().waitFor();
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  // The bed is the only thing on the canvas at (40,40)-(140,140) - click
  // its center. Kept generic (not hardcoding world coords here) by reading
  // the bed's own name back out of the opened panel instead of relying on
  // exact pixel math this test doesn't otherwise need.
  await page.mouse.click(box.x + 90, box.y + 90);
  await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
  await expect(page.getByRole("textbox").first()).toHaveValue(bedName);
}

test.describe("Shared Input/Select/Textarea primitives (#142)", () => {
  test("BedPanel's numeric Input, Select, and Textarea all wire through to real persisted PATCHes", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Input Primitives Bed", rect(40, 40, 100, 100));

    try {
      await openBedPanel(page, "E2E Input Primitives Bed");

      // --- numeric Input (width) ---
      const widthInput = page.getByRole("spinbutton").first();
      await widthInput.fill("150");
      await widthInput.blur();
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.width, {
          message: "width numeric Input's value never persisted",
        })
        .toBe(150);

      // --- Select (sun level) ---
      await page.getByRole("combobox").selectOption("half_sun");
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).sun_level, {
          message: "Select's chosen option never persisted",
        })
        .toBe("half_sun");

      // --- Textarea (notes) ---
      const notesTextarea = page.locator("textarea");
      await notesTextarea.fill("Planted a mix of nightshades this year.");
      await notesTextarea.blur();
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).notes, {
          message: "Textarea's value never persisted",
        })
        .toBe("Planted a mix of nightshades this year.");

      // Sanity: everything landed together, not just individually observed
      // mid-flight by the polling above.
      const final = await (await request.get(`/api/beds/${bed.id}`)).json();
      expect(final.border_geometry.width).toBe(150);
      expect(final.sun_level).toBe("half_sun");
      expect(final.notes).toBe("Planted a mix of nightshades this year.");
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
