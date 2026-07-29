import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #49 ("Mobile/PWA simplified route set") -
 * the implementer's own outcome comment explicitly flagged this gap: "No
 * browser automation available in this environment, so the actual
 * phone-width vs. desktop-width visual switch is left for the tester
 * role to confirm." Individual mobile screens (agenda content, bottom
 * nav, notifications) already have their own dedicated coverage
 * elsewhere in this directory - what's specifically untested is the
 * `useIsMobileViewport`/`RootShell` breakpoint switch mechanism itself:
 * that desktop width genuinely shows the canvas-editor app (not a
 * squeezed mobile view), phone width genuinely shows the separate mobile
 * shell (not a squeezed desktop view), and the switch actually tracks a
 * live resize rather than only being decided once at initial page load.
 */

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("Desktop canvas editor vs. mobile shell route switch (#49)", () => {
  test("a desktop-width viewport shows the desktop Home/canvas-editor app, not the mobile shell", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // Desktop Home has a real "Open bed layout" link the mobile shell
    // doesn't - and no mobile bottom tab bar.
    await expect(page.getByRole("link", { name: "Open bed layout" })).toBeVisible();
    await page.getByRole("link", { name: "Open bed layout" }).click();
    await page.locator("canvas").first().waitFor();
    await dismissOnboardingIfPresent(page);
    // The real canvas editor, not a squeezed-down mobile view.
    const box = await page.locator("canvas").first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(400); // a real desktop-sized canvas, not a phone-width sliver
  });

  test("a phone-width viewport shows the separate mobile shell, not a squeezed desktop app", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // MobileHome's own real content - "Open bed layout" (desktop-only)
    // must not appear at all.
    await expect(page.getByText(/simplified mobile view/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open bed layout" })).toHaveCount(0);
    // No Konva canvas anywhere in the mobile tree.
    await expect(page.locator("canvas")).toHaveCount(0);

    // The mobile shell's own bottom tab bar is present (Home/Agenda/
    // Logging/Notifications), confirming this is genuinely the separate
    // mobile route tree, not the desktop AppShell.
    await expect(page.getByRole("link", { name: /^Agenda$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Logging$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Notifications$/ })).toBeVisible();
  });

  test("a desktop-only deep link (/layout) opened at phone width falls back to the mobile home instead of 404ing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/layout");

    // No canvas, no 404 - the documented "no mobile equivalent to route
    // to" fallback lands on MobileHome.
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByText(/simplified mobile view/)).toBeVisible();
  });

  test("resizing the window live actually crosses the breakpoint and switches views, not just at initial load", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Open bed layout" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    // useIsMobileViewport tracks a live matchMedia "change" event - no
    // reload here, just a resize - so this must flip without navigating.
    await expect(page.getByText(/simplified mobile view/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open bed layout" })).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("link", { name: "Open bed layout" })).toBeVisible();
    await expect(page.getByText(/simplified mobile view/)).toHaveCount(0);
  });
});
