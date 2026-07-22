import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #143 ("Add a shared accessible segmented-
 * control/toggle-group primitive") - the implementer's own outcome comment
 * says "no screen reader or browser automation available in this
 * environment... reasoned through the ARIA attributes and keyboard handling
 * by hand instead, but this still needs an actual human/tester keyboard
 * pass before being called verified." This drives real keyboard/click
 * interaction through both new primitives (`TabToggleGroup` built on
 * base-ui's `Tabs`, and the hand-rolled `RadioToggleGroup`) at their 5 real
 * call sites, plus `ShapeTypeToggle`'s asymmetric lossy-conversion-confirm
 * behavior that sits on top of `RadioToggleGroup`.
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

async function gotoLayout(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
}

test.describe("Shared toggle-group primitives (#143)", () => {
  test("View mode RadioToggleGroup: correct ARIA roles, roving tabindex, click selects", async ({ page }) => {
    await gotoLayout(page);

    const group = page.getByRole("radiogroup", { name: "View mode" });
    await expect(group).toBeVisible();

    const editOption = group.getByRole("radio", { name: "Edit" });
    const viewOption = group.getByRole("radio", { name: "View" });

    // Default state: Edit is checked and the only one in the tab order.
    await expect(editOption).toHaveAttribute("aria-checked", "true");
    await expect(viewOption).toHaveAttribute("aria-checked", "false");
    await expect(editOption).toHaveAttribute("tabindex", "0");
    await expect(viewOption).toHaveAttribute("tabindex", "-1");

    // Click the other option selects it and flips the roving tabindex.
    await viewOption.click();
    await expect(viewOption).toHaveAttribute("aria-checked", "true");
    await expect(editOption).toHaveAttribute("aria-checked", "false");
    await expect(viewOption).toHaveAttribute("tabindex", "0");
    await expect(editOption).toHaveAttribute("tabindex", "-1");

    await editOption.click();
    await expect(editOption).toHaveAttribute("aria-checked", "true");
    await expect(viewOption).toHaveAttribute("aria-checked", "false");
  });

  // NOTE: arrow-key focus-retention (the WAI-ARIA radiogroup pattern
  // RadioToggleGroup implements - see its own docstring) is deliberately
  // NOT exercised on the View-mode toggle above. Switching mode back to
  // "mine" remounts GardenPanel.tsx, which has its own unconditional
  // `autoFocus` on its Name input (unrelated to this ticket) - that steals
  // focus away from whatever RadioToggleGroup just (correctly) focused,
  // which would make a real, separate bug look like a #143 regression.
  // Filed as its own ticket (see this spec's own follow-up in the tester's
  // report) rather than folded in here per the "test what the ticket
  // actually touched" scope rule. The Placement Mode toggle below (Plants
  // tab, no such autoFocus neighbor) gives the same RadioToggleGroup
  // component a clean arrow-key test instead.
  test("Placement mode RadioToggleGroup: arrow keys move focus and select together, wrap at both ends", async ({
    page,
    request,
  }) => {
    const slug = `e2e-toggle-group-plant-${Date.now()}`;
    const commonName = `E2E Toggle Group Plant ${Date.now()}`;
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });

    try {
      await gotoLayout(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.getByRole("button", { name: "Pick a plant" }).click();
      await page.getByRole("button", { name: new RegExp(commonName) }).click();
      await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);

      const group = page.getByRole("radiogroup", { name: "Placement mode" });
      await expect(group).toBeVisible();
      const pointOption = group.getByRole("radio", { name: "Point" });
      const rowOption = group.getByRole("radio", { name: "Row" });
      const areaOption = group.getByRole("radio", { name: "Area" });

      await expect(pointOption).toHaveAttribute("aria-checked", "true");
      await pointOption.focus();

      // Arrow-right moves focus to Row AND selects it in one step
      // (radiogroup semantics - unlike a tablist, focus and selection move
      // together).
      await page.keyboard.press("ArrowRight");
      await expect(rowOption).toBeFocused();
      await expect(rowOption).toHaveAttribute("aria-checked", "true");
      await expect(pointOption).toHaveAttribute("aria-checked", "false");
      await expect(rowOption).toHaveAttribute("tabindex", "0");
      await expect(pointOption).toHaveAttribute("tabindex", "-1");

      await page.keyboard.press("ArrowRight");
      await expect(areaOption).toBeFocused();
      await expect(areaOption).toHaveAttribute("aria-checked", "true");

      // Wraps from the last option back to the first.
      await page.keyboard.press("ArrowRight");
      await expect(pointOption).toBeFocused();
      await expect(pointOption).toHaveAttribute("aria-checked", "true");

      // Wraps the other direction too (Left from the first option -> last).
      await page.keyboard.press("ArrowLeft");
      await expect(areaOption).toBeFocused();
      await expect(areaOption).toHaveAttribute("aria-checked", "true");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("Garden/Beds/Plants/Equipment TabToggleGroup: real tablist semantics, click switches panel content", async ({
    page,
  }) => {
    await gotoLayout(page);

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible();

    const gardenTab = page.getByRole("tab", { name: "Garden" });
    const bedsTab = page.getByRole("tab", { name: "Beds" });
    const plantsTab = page.getByRole("tab", { name: "Plants" });

    // Garden is the default active tab (Layout.tsx's initial state) - only
    // the active tab is in the tab order (roving tabindex from base-ui's
    // Tabs).
    await expect(gardenTab).toHaveAttribute("aria-selected", "true");
    await expect(gardenTab).toHaveAttribute("tabindex", "0");
    await expect(bedsTab).toHaveAttribute("aria-selected", "false");
    await expect(bedsTab).toHaveAttribute("tabindex", "-1");

    // Clicking Beds actually switches the panel content ("Add bed" is
    // Beds-tab-only per Toolbar.tsx) - not just a visual toggle.
    await expect(page.getByRole("button", { name: "Add bed" })).not.toBeVisible();
    await bedsTab.click();
    await expect(bedsTab).toHaveAttribute("aria-selected", "true");
    await expect(gardenTab).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("button", { name: "Add bed" })).toBeVisible();

    // Clicking Plants switches again, confirming the group generalizes past
    // a simple two-state toggle.
    await plantsTab.click();
    await expect(plantsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Pick a plant" })).toBeVisible();
  });

  test("ShapeTypeToggle: Rectangle->Polygon is immediate, Polygon->Rectangle asks to confirm and is cancelable", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Toggle Group Bed", rect(300, 300, 100, 100));

    try {
      await gotoLayout(page);
      await page.getByRole("tab", { name: "Beds" }).click();
      const canvasBox = await page.locator("canvas").first().boundingBox();
      if (!canvasBox) throw new Error("canvas not visible");
      await page.mouse.click(canvasBox.x + 350, canvasBox.y + 350);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      const shapeGroup = page.getByRole("radiogroup", { name: "Shape type" });
      const rectangleOption = shapeGroup.getByRole("radio", { name: "Rectangle" });
      const polygonOption = shapeGroup.getByRole("radio", { name: "Polygon" });
      await expect(rectangleOption).toHaveAttribute("aria-checked", "true");

      // Rectangle -> Polygon: lossless, no confirm dialog, persists.
      await polygonOption.click();
      await expect(polygonOption).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.type, {
          message: "Rectangle->Polygon conversion never persisted",
        })
        .toBe("polygon");

      // Polygon -> Rectangle: lossy, must confirm first.
      await rectangleOption.click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByRole("heading", { name: "Switch to rectangle?" })).toBeVisible();

      // Cancel: geometry must remain a polygon (both on screen and persisted).
      await confirmDialog.getByRole("button", { name: "No - keep polygon" }).click();
      await expect(confirmDialog).not.toBeVisible();
      await expect(polygonOption).toHaveAttribute("aria-checked", "true");
      const afterCancel = await (await request.get(`/api/beds/${bed.id}`)).json();
      expect(afterCancel.border_geometry.type).toBe("polygon");

      // Try again and actually confirm this time - now it converts.
      await rectangleOption.click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: "Yes - delete points" }).click();
      await expect(page.getByRole("alertdialog")).not.toBeVisible();
      await expect(rectangleOption).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.type, {
          message: "Polygon->Rectangle conversion never persisted after confirming",
        })
        .toBe("rectangle");
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
