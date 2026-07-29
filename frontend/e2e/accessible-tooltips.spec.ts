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
 * CONFIRMED REAL BUG while writing this, reproducible and root-caused via
 * direct DOM inspection (not a Playwright timing artifact - a hover-based
 * positive control using identical detection logic passes cleanly):
 *
 * - The Button-wrapped tooltip pattern (Toolbar's Undo/Redo/Fit view,
 *   EquipmentPanel's Unplace - `<Tooltip content="..."><Button>...</Button>
 *   </Tooltip>`) genuinely does open on keyboard focus, not just hover -
 *   `Button` forwards refs into a real `<button>` DOM element, which
 *   `Tooltip.Trigger`'s underlying base-ui primitive renders as/wraps
 *   correctly, tabindex and all.
 * - `FieldHint` - the icon-based pattern used for the vast majority of the
 *   53 occurrences this ticket replaced (every field-label row, every
 *   table column header, every section heading) - is a different story.
 *   `Tooltip.Trigger`'s `render={children}` merges the trigger's props
 *   directly onto whatever `children` is; for `FieldHint` that's a bare
 *   `<Info />` from `lucide-react`, which renders as a raw `<svg>` with no
 *   `tabindex` at all and `aria-hidden="true"` (lucide's own decorative-icon
 *   default). The result: every single field-level tooltip hint in the app
 *   is completely unreachable via keyboard Tab and hidden from assistive
 *   tech - confirmed directly in the DOM snapshot below, not inferred.
 *   This is the exact "keyboard/touch inaccessible" problem #145 exists to
 *   fix, now reproduced for the pattern covering the overwhelming majority
 *   of its own 53 occurrences.
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
    // KNOWN REAL BUG (found by this test, filed on #145 - see that issue's
    // tester comment): `FieldHint`'s bare `<Info />` (lucide-react) renders
    // as a raw `<svg>` with no `tabindex` and `aria-hidden="true"` - it's
    // never reachable via keyboard Tab, so this assertion fails at
    // `toBeFocused()` before even getting to the tooltip-visibility check.
    // This affects every field-label row, table column header, and section
    // heading FieldHint in the app - the overwhelming majority of the 53
    // occurrences this ticket set out to fix. Left failing on purpose.
    const bed = await createBed(request, "E2E Tooltip Bed 3", rect(40, 40, 100, 100));
    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();
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

      await nameFieldHint.focus();
      await expect(nameFieldHint).toBeFocused();
      await expect(page.getByText("The bed's display name")).toBeVisible();
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
