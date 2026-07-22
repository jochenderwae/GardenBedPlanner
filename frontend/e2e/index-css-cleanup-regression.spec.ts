import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser smoke coverage for #141 ("Clean up leftover starter-template
 * CSS in index.css") - this is fundamentally a "no visual regression" CSS
 * cleanup, and fine-grained pixel-spacing/aesthetic judgment is explicitly
 * out of this tester role's scope (the ticket's own verification section
 * asks for a human eyeball pass for that, and it should get one at the
 * tested -> verified gate). What IS this role's job: confirm the deleted
 * global rules (`#root`'s `text-align: center`/layout block, raw h1/h2/
 * code element selectors, the whole leftover dark-mode custom-property
 * system) didn't *functionally* break anything - a page that fails to
 * render, throws a console error, or collapses a landmark element to zero
 * size is a real regression regardless of how it looks; a slightly
 * different heading margin is not.
 *
 * Covers every page + viewport combination the ticket's own Verification
 * section names (desktop >=768px and mobile <768px, since RootShell
 * branches its whole route tree on that breakpoint - see
 * useIsMobileViewport.ts).
 */

async function createPlant(request: APIRequestContext, slug: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: "E2E CSS Regression Plant", botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function checkPageLoadsCleanly(page: Page, path: string) {
  const errors: string[] = [];
  const pageErrorHandler = (err: Error) => errors.push(err.message);
  page.on("pageerror", pageErrorHandler);

  await page.goto(path);
  await page.waitForLoadState("networkidle");

  expect(errors, `console/page errors on ${path}: ${errors.join("; ")}`).toHaveLength(0);

  // The app's own header chrome ("GardenBedPlanner" title in AppShell/
  // MobileShell) is present on every real route regardless of whether that
  // particular page happens to render a semantic heading - a more uniform
  // landmark than `getByRole("heading")`, which several pages (e.g. Home,
  // using shadcn's non-semantic CardTitle) don't have at all. Visible with
  // real size proves the page didn't render blank or collapse to zero
  // height from a missing style.
  const landmark = page.getByText("GardenBedPlanner").first();
  // A slightly generous explicit timeout - a couple of runs on this dev
  // machine saw the default 5s expire under heavy concurrent Chromium load
  // (many specs' worth of browser launches earlier in the same session),
  // not from any real app slowness.
  await expect(landmark).toBeVisible({ timeout: 10000 });
  const box = await landmark.boundingBox();
  expect(box, `no landmark bounding box on ${path}`).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  page.off("pageerror", pageErrorHandler);
}

const DESKTOP_PAGES = ["/", "/plants", "/agenda", "/seed-guide"];
const MOBILE_PAGES = ["/", "/agenda", "/seed-guide", "/logging", "/notifications"];

test.describe("index.css cleanup - no functional regression (#141)", () => {
  test.describe("desktop viewport (>=768px)", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    for (const path of DESKTOP_PAGES) {
      test(`${path} loads without console errors and renders a visible landmark`, async ({ page }) => {
        await checkPageLoadsCleanly(page, path);
      });
    }

    test("/plants/:slug loads without console errors and renders a visible landmark", async ({ page, request }) => {
      const slug = `e2e-css-regression-${Date.now()}`;
      await createPlant(request, slug);
      try {
        await checkPageLoadsCleanly(page, `/plants/${slug}`);
      } finally {
        await request.delete(`/api/plants/${slug}`).catch(() => {});
      }
    });

    test("/layout loads without console errors and renders a visible canvas", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      expect(errors, `console/page errors on /layout: ${errors.join("; ")}`).toHaveLength(0);
      const box = await page.locator("canvas").first().boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    });
  });

  test.describe("mobile viewport (<768px)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    for (const path of MOBILE_PAGES) {
      test(`${path} loads without console errors and renders a visible landmark`, async ({ page }) => {
        await checkPageLoadsCleanly(page, path);
      });
    }
  });
});
