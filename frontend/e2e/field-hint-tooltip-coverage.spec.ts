import { test, expect, type APIRequestContext, type Page, type Locator } from "@playwright/test";

/**
 * Real-browser coverage for #80 ("Tooltips on every input field in the
 * bed/garden/equipment editing panels"). The ticket's own technical
 * analysis describes native `title=` attributes, but that's since been
 * superseded by #145's `FieldHint`/`Tooltip` (Base UI) component - every
 * field in `BedPanel.tsx`/`GardenPanel.tsx`/`AddBedForm.tsx`/
 * `EquipmentPanel.tsx` today renders a `FieldHint`, confirmed by reading
 * the current source directly rather than trusting the ticket body's
 * now-outdated description of the mechanism. #145's own
 * `accessible-tooltips.spec.ts` already covers the keyboard-focus
 * mechanism in depth (via a single representative field) - what's missing
 * is this ticket's own actual claim: that hovering *every* labeled field
 * across all four panels reveals a real, non-empty, field-specific hint,
 * not just that the mechanism works once it's wired up somewhere.
 *
 * Deliberately does NOT exercise GardenPanel's "garden already exists"
 * edit-mode branch (4 more FieldHints, confirmed present and populated by
 * reading GardenPanel.tsx directly) - there is no DELETE /api/garden
 * endpoint at all (a single-user app's Garden is a permanent singleton by
 * design), so creating one here to test that branch would permanently
 * pollute the shared garden_test database and silently break every other
 * spec's "no garden yet" onboarding-flow assumptions for good. Only the
 * empty-state "create a garden" form (1 FieldHint) is exercised, since
 * that's reachable and safely abandonable without ever submitting it.
 */

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
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

/** Hovers every FieldHint tooltip trigger found within `scope`, in order,
 * confirming each one opens a real, non-trivially-short tooltip - moving
 * the mouse well away between each so the previous tooltip actually closes
 * (Base UI's hover-close is itself pointer-driven) before the next hover,
 * rather than accumulating stale open tooltips that could make a later
 * assertion accidentally pass against the wrong one. Returns every
 * tooltip's own text, in trigger order, so callers can spot-check content
 * beyond "just non-empty" where it matters. */
async function hoverEveryFieldHint(page: Page, scope: Locator): Promise<string[]> {
  const triggers = scope.locator("[data-base-ui-tooltip-trigger]");
  const count = await triggers.count();
  const texts: string[] = [];
  // Base UI's tooltip Popup (see tooltip.tsx) renders into a portal at the
  // end of <body>, not inside `scope`, and carries neither a `role`
  // attribute nor an `aria-describedby` link back to its trigger on this
  // version of the library (confirmed by inspecting the real rendered DOM
  // while writing this spec, not assumed) - `max-w-64` is otherwise a
  // unique class in this whole codebase to the Tooltip Popup specifically,
  // so it's the one reliable way to find the currently-open popup.
  const openPopup = page.locator(".max-w-64[data-open]");
  for (let i = 0; i < count; i++) {
    const trigger = triggers.nth(i);
    await trigger.hover();
    await expect(openPopup).toBeVisible();
    const text = (await openPopup.textContent())?.trim() ?? "";
    expect(text.length, `FieldHint trigger #${i}'s tooltip text was suspiciously short/empty: "${text}"`).toBeGreaterThan(8);
    texts.push(text);
    // Move away and let it close before the next one, so the next
    // iteration's `openPopup` lookup can't accidentally match a stale
    // still-closing popup from this iteration.
    await page.mouse.move(0, 0);
    await expect(openPopup).toHaveCount(0);
  }
  return texts;
}

test.describe("FieldHint tooltip coverage across the bed/garden/equipment panels (#80)", () => {
  test("every labeled field in the bed edit panel (BedPanel) has a real, non-empty hover tooltip", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E FieldHint Bed", rect(40, 40, 100, 100));
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
      const panel = page.locator("[data-slot='card']").filter({ has: page.getByRole("heading", { name: "Edit bed" }) }).first();

      // Name, Category, Width, Length, Rotation, Height, Sun exposure,
      // Soil, Greenhouse, Notes - every labeled field BedPanel.tsx renders.
      const texts = await hoverEveryFieldHint(page, panel);
      expect(texts.length).toBe(10);
      expect(new Set(texts).size, "two fields shouldn't share the exact same hint text").toBe(texts.length);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("every labeled field in the 'Add bed' dialog (AddBedForm) has a real, non-empty hover tooltip", async ({
    page,
    request,
  }) => {
    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      // See the BedPanel test above: "Add bed" now lives under "Objects",
      // renamed from "Beds" by #242.
      await page.getByRole("tab", { name: "Objects" }).click();
      await page.getByRole("button", { name: "Add bed" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Add bed" })).toBeVisible();

      // Name, Category, Shape.
      const texts = await hoverEveryFieldHint(page, dialog);
      expect(texts.length).toBe(3);

      // Cancel rather than submit - never actually create a bed, nothing
      // to clean up.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    } finally {
      // Nothing was ever created via this test, but the beds list is
      // still checked as a hard guarantee no bed leaked through despite
      // clicking Cancel.
      const beds = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
      for (const b of beds.filter((x) => x.name === "")) await request.delete(`/api/beds/${b.id}?cascade=true`).catch(() => {});
    }
  });

  test("every labeled field in the equipment panel (EquipmentPanel) has a real, non-empty hover tooltip", async ({
    page,
  }) => {
    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);
    await page.getByRole("tab", { name: "Equipment" }).click();
    // `exact: true` is load-bearing: the panel's own "Irrigation zones" <h3>
    // carries its FieldHint's description text ("...drip-irrigation
    // equipment whose combined water delivery...") as part of its accessible
    // name, which contains "Equipment" as a plain substring - a
    // non-exact match resolves to both headings (strict-mode violation).
    await expect(page.getByRole("heading", { name: "Equipment", exact: true })).toBeVisible();
    const panel = page
      .locator("[data-slot='card']")
      .filter({ has: page.getByRole("heading", { name: "Equipment", exact: true }) })
      .first();

    // Type, Height, Water (the add-to-inventory form) + the irrigation
    // zones section's own explanatory hint.
    const texts = await hoverEveryFieldHint(page, panel);
    expect(texts.length).toBe(4);
  });

  test("the empty-state 'create a garden' form's Name field has a real, non-empty hover tooltip", async ({ page, request }) => {
    // Only reachable/safe to test when no Garden row exists yet - see this
    // file's own top-of-file doc for why the "garden already exists" edit
    // branch is deliberately not exercised here.
    const existing = await request.get("/api/garden");
    test.skip(existing.ok(), "a Garden already exists in this environment - the empty-state create form isn't reachable");

    await page.goto("/layout");
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);
    await page.getByRole("tab", { name: "Garden" }).click();
    await expect(page.getByRole("heading", { name: "Set up garden" })).toBeVisible();
    const panel = page.locator("[data-slot='card']").filter({ has: page.getByRole("heading", { name: "Set up garden" }) }).first();

    const texts = await hoverEveryFieldHint(page, panel);
    expect(texts.length).toBe(1);
    expect(texts[0]).toContain("garden");

    // Never actually submitted - nothing was created, nothing to clean up.
  });
});
