import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #113 ("No scroll bars in Bed Layout screen") -
 * all 3 of the ticket's own "How to test" steps are real-viewport layout
 * behavior (page-level scroll presence, canvas tracking a resized window,
 * a side panel scrolling internally instead of the whole page) that a
 * typecheck/build can't observe at all. The implementer's own outcome
 * comment confirms this stopped at build/lint/test-level verification.
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

async function pageHasVerticalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.scrollingElement;
    return !!el && el.scrollHeight > el.clientHeight + 1; // +1: rounding slack
  });
}

test.describe("No page-level scroll bars in the Bed Planner (#113)", () => {
  test("the layout screen has no page-level vertical scroll at a typical desktop viewport", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Scroll Bed", rect(100, 100, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      expect(await pageHasVerticalScroll(page), "the /layout page itself scrolls vertically").toBe(false);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("the canvas resizes to fill the available space when the window is resized, not staying a fixed size", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Resize Bed", rect(100, 100, 80, 80));

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      const initialBox = await page.locator("canvas").first().boundingBox();
      if (!initialBox) throw new Error("canvas not visible");

      await page.setViewportSize({ width: 1280, height: 500 });
      await page.waitForTimeout(300); // let the ResizeObserver settle

      const resizedBox = await page.locator("canvas").first().boundingBox();
      if (!resizedBox) throw new Error("canvas not visible after resize");

      expect(
        resizedBox.height,
        `canvas height didn't shrink with the window (was ${initialBox.height}, still ${resizedBox.height})`,
      ).toBeLessThan(initialBox.height - 100);
      expect(await pageHasVerticalScroll(page), "the page scrolls vertically after shrinking the window").toBe(false);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("a side panel taller than the available space scrolls internally, not the whole page", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Panel Scroll Bed", rect(100, 100, 80, 80));

    try {
      // Short enough that BedPanel's full field list (name, category,
      // shape toggle, width/length/rotation, height, sun level, soil type,
      // greenhouse checkbox, notes, delete button) can't fit without
      // scrolling.
      await page.setViewportSize({ width: 1280, height: 420 });
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      await page.mouse.click(box.x + 140, box.y + 140);
      const panelHeading = page.getByRole("heading", { name: "Edit bed" });
      await expect(panelHeading).toBeVisible();

      // The panel itself (an ancestor with overflow-y-auto) should have
      // real internal overflow.
      const panelScrolls = await panelHeading.evaluate((headingEl) => {
        let el: HTMLElement | null = headingEl.parentElement;
        while (el) {
          const style = getComputedStyle(el);
          if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
            return true;
          }
          el = el.parentElement;
        }
        return false;
      });
      expect(panelScrolls, "no scrollable ancestor found for the open BedPanel at a short viewport").toBe(true);

      expect(await pageHasVerticalScroll(page), "the whole page scrolls instead of just the panel").toBe(false);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
