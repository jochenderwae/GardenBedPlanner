import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #74 ("Width/length/rotation number inputs in
 * the bed panel are too small") - no implementer outcome comment. A
 * genuinely visual/rendering fix (WebKit spin-button suppression + a wider
 * panel) that no typecheck/Vitest test could catch - this drives real text
 * entry and measures the actual rendered box, not just that the class
 * names look right.
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

test.describe("Bed panel numeric input sizing (#74)", () => {
  test("a multi-digit width/length/rotation value is never clipped, and the panel is comfortably wide", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Numeric Sizing Bed", rect(40, 40, 100, 100));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Objects" }).click();
      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      await page.mouse.click(box.x + 90, box.y + 90);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      const spinbuttons = page.getByRole("spinbutton");
      const widthInput = spinbuttons.nth(0);
      const lengthInput = spinbuttons.nth(1);
      const rotationInput = spinbuttons.nth(2);

      await widthInput.fill("1234.5");
      await lengthInput.fill("999.9");
      await rotationInput.fill("270");

      // A clipped value's scrollWidth exceeds its clientWidth (the text
      // content is wider than the box actually rendering it) - the real,
      // measurable signature of the bug this ticket fixes.
      for (const input of [widthInput, lengthInput, rotationInput]) {
        const { scrollWidth, clientWidth } = await input.evaluate((el: HTMLInputElement) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(scrollWidth, `input value is clipped (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`).toBeLessThanOrEqual(
          clientWidth,
        );
      }

      // The panel itself is meaningfully wider than the old w-72 (18rem =
      // 288px) - w-80 is 20rem = 320px. A generous threshold between the
      // two avoids being a pixel-exact/fragile assertion while still
      // catching a regression back to the cramped width.
      const panelWidth = await page.locator('[data-slot="card"]').first().evaluate((el) => el.getBoundingClientRect().width);
      expect(panelWidth).toBeGreaterThan(300);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
