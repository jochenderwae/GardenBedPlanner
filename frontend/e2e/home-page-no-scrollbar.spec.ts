import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #147 ("Home.tsx's min-h-svh causes an
 * unnecessary scrollbar under AppShell's viewport-bounded layout") - the
 * fix (min-h-svh -> h-full) is a Tailwind class swap whose actual effect
 * is page-level scroll presence at a real viewport size, which neither a
 * typecheck nor `npm run build` can observe. Reuses the same
 * `pageHasVerticalScroll` technique `no-page-scrollbars.spec.ts` (#113)
 * already established for exactly this class of bug, applied to the one
 * page (`/`, Home.tsx) that ticket never covered.
 */

async function pageHasVerticalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.scrollingElement;
    return !!el && el.scrollHeight > el.clientHeight + 1; // +1: rounding slack
  });
}

test.describe("Home page has no unnecessary page-level scrollbar (#147)", () => {
  test("no vertical scroll at a typical desktop viewport, card stays visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.getByText("GardenBedPlanner").first()).toBeVisible();

    expect(await pageHasVerticalScroll(page), "the Home page itself scrolls vertically at a normal desktop size").toBe(
      false,
    );
  });

  test("no vertical scroll and the card doesn't clip at a short/laptop-height window", async ({ page }) => {
    // Short enough that min-h-svh (a full 100vh child nested inside a
    // shorter main) would have provably overflowed main's own bounds -
    // the exact scenario the ticket's own root-cause analysis describes.
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto("/");
    await expect(page.getByText("GardenBedPlanner").first()).toBeVisible();

    expect(await pageHasVerticalScroll(page), "the Home page scrolls vertically at a short window").toBe(false);

    // The card itself should still be fully visible (not clipped off the
    // top/bottom) - a real regression this fix could introduce if h-full
    // ever collapsed to zero height instead of AppShell main's own real
    // available space. shadcn's CardTitle renders a plain
    // data-slot="card-title" div, not a real heading role, so that's the
    // reliable selector here rather than getByRole("heading").
    const cardTitle = page.locator('[data-slot="card-title"]').first();
    await expect(cardTitle).toBeVisible();
    const box = await cardTitle.boundingBox();
    expect(box, "no card-title bounding box found on the Home page").not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });
});
