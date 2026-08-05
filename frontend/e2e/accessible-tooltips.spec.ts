import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #145 ("Replace title= attribute tooltips with
 * an accessible Tooltip component") - the implementer's own outcome
 * comment says the new `Tooltip`/`FieldHint` (base-ui's `Tooltip`
 * primitive) "opens on both hover and focus by default, closing that gap
 * with no custom keyboard wiring needed... reasoned through base-ui's
 * documented hover+focus tooltip behavior instead [of testing it], but
 * this still needs an actual human/tester keyboard pass before being
 * called verified." This drives exactly that keyboard pass.
 *
 * FieldHint's original bare-`<svg>` keyboard-inaccessibility bug (found by
 * an earlier version of this spec, filed on #145) was fixed in commit
 * 12c31cb - it's now wrapped in a real `<button type="button">`, matching
 * the already-working Button-wrapped Tooltip pattern (Toolbar's Undo/Redo/
 * Fit view). That fix's own follow-up comment flagged a real, separate
 * subtlety this spec's `FieldHint` test methodology needs to account for:
 * a bare `.focus()` call right after a mouse click does NOT reliably open
 * the tooltip, because Base UI's `Tooltip` gates its focus-triggered open
 * on real `:focus-visible` semantics (`floating-ui-react`'s `useFocus`),
 * and Chromium doesn't grant `:focus-visible` to a *programmatic* `.focus()`
 * call once "mouse modality" was established earlier in the same page
 * session (exactly what clicking the bed to open BedPanel does) - a genuine
 * keyboard Tab keypress always re-arms it regardless of what came before.
 * The FieldHint test below reaches its target via real `Tab` keypresses
 * (the actual keyboard-user path), not `.focus()`, for that reason - see
 * `tabUntilFocused`'s own doc.
 */

/** Presses Tab up to `maxPresses` times, stopping as soon as `target` is
 * the focused element - real keyboard traversal, not a guessed exact
 * tab-index position (this component's DOM order isn't this spec's concern
 * to hard-code) and not a bare `.focus()` call, which doesn't satisfy
 * `:focus-visible` the same way after a prior mouse interaction - see this
 * file's own top-of-file doc for why that distinction matters here. */
async function tabUntilFocused(page: Page, target: import("@playwright/test").Locator, maxPresses = 15): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  // One last check after the final press, so a target reached on exactly
  // the maxPresses'th Tab still counts.
  if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  throw new Error(`target not reached via Tab within ${maxPresses} presses`);
}

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("Accessible Tooltip component (#145)", () => {
  test("a Button-wrapped tooltip (Fit view) opens on hover", async ({ page, request }) => {
    await createBed(request, "E2E Tooltip Bed", rect(40, 40, 100, 100));
    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      const fitViewButton = page.getByRole("button", { name: /Fit view/ });
      await fitViewButton.hover();
      await expect(page.getByText("Fit the whole garden in view")).toBeVisible();
    } finally {
      const beds = await (await request.get("/api/beds")).json();
      for (const b of beds as { id: number; name: string }[]) {
        if (b.name === "E2E Tooltip Bed") await request.delete(`/api/beds/${b.id}?cascade=true`).catch(() => {});
      }
    }
  });

  test("a Button-wrapped tooltip (Fit view) opens on keyboard focus, not just hover", async ({ page, request }) => {
    await createBed(request, "E2E Tooltip Bed 2", rect(40, 40, 100, 100));
    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      const fitViewButton = page.getByRole("button", { name: /Fit view/ });
      await fitViewButton.focus();
      await expect(fitViewButton).toBeFocused();
      // This is the actual behavior a keyboard-only user needs (Tab to a
      // control, see its hint) - the ticket's own core purpose. Passes: the
      // Button-wrapped Tooltip pattern genuinely works via keyboard focus
      // (contrast with the FieldHint-icon pattern below, which doesn't).
      await expect(page.getByText("Fit the whole garden in view")).toBeVisible();
    } finally {
      const beds = await (await request.get("/api/beds")).json();
      for (const b of beds as { id: number; name: string }[]) {
        if (b.name === "E2E Tooltip Bed 2") await request.delete(`/api/beds/${b.id}?cascade=true`).catch(() => {});
      }
    }
  });

  test("a FieldHint icon tooltip (BedPanel's Name field) opens on keyboard focus, not just hover", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Tooltip Bed 3", rect(40, 40, 100, 100));
    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      // The bed create/edit panel now lives under the "Objects" tab (#242
      // merged bed/compost-bin/decoration creation into it) - it was called
      // "Beds" when this spec was first written.
      await page.getByRole("tab", { name: "Objects" }).click();
      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      await page.mouse.click(box.x + 90, box.y + 90);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      // The Name field's FieldHint is the first tooltip trigger inside the
      // panel's own form, right after the "Name" label text.
      const nameFieldHint = page
        .locator("label")
        .filter({ hasText: "Name" })
        .locator("[data-base-ui-tooltip-trigger]")
        .first();
      await expect(nameFieldHint).toBeVisible();

      // Real Tab traversal, not `.focus()` - see this file's own top-of-file
      // doc for why a bare `.focus()` right after the mouse click above
      // wouldn't reliably satisfy `:focus-visible` the way a genuine
      // keyboard user's Tab keypress does.
      await tabUntilFocused(page, nameFieldHint);
      await expect(nameFieldHint).toBeFocused();
      await expect(page.getByText("The bed's display name")).toBeVisible();
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
