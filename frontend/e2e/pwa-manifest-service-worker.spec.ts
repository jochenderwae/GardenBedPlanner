import { test, expect } from "@playwright/test";

/**
 * Real-browser coverage for #47 ("PWA manifest + service worker") - every
 * outcome comment on this ticket flagged the same limitation: "No
 * browser-automation tool available in this environment for an actual
 * Lighthouse/DevTools installability check." A headless Playwright run is
 * exactly the non-interactive, scriptable verification that limitation
 * describes as unavailable elsewhere in this project.
 *
 * `vite-plugin-pwa` only actually injects the manifest `<link>`/registers
 * a real service worker in a *production build* (`vite build` + `vite
 * preview`) - the dev server this suite's other specs run against
 * (`npm run dev`, no `devOptions.enabled` in `vite.config.ts`) never
 * serves either, confirmed by inspecting the dev server's own raw HTML
 * before writing this spec. So this file deliberately targets a
 * `PWA_PREVIEW_URL` env var pointing at a running `vite preview` instance
 * of the built `dist/` output, rather than this project's usual
 * `baseURL` - skips itself cleanly with an explanatory message if that
 * env var isn't set, rather than silently testing the wrong server or
 * failing with a confusing connection error. See this file's own header
 * comment in the PR/commit history for the exact commands to build and
 * serve it locally (`npm run build && npm run preview -- --port 4173`,
 * then `PWA_PREVIEW_URL=http://localhost:4173 npx playwright test
 * pwa-manifest-service-worker.spec.ts`).
 */

const PREVIEW_URL = process.env.PWA_PREVIEW_URL;

test.describe("PWA manifest + service worker (#47)", () => {
  test.skip(!PREVIEW_URL, "PWA_PREVIEW_URL not set - run against a `vite preview` build, not the dev server (see this file's own header doc)");

  test("the manifest link is present and the manifest itself is valid, installable JSON", async ({ page }) => {
    await page.goto(PREVIEW_URL!);

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);
    const href = await manifestLink.getAttribute("href");
    expect(href).toBeTruthy();

    const manifestRes = await page.request.get(new URL(href!, PREVIEW_URL).toString());
    expect(manifestRes.ok(), "manifest.webmanifest itself must be fetchable").toBeTruthy();
    const manifest = await manifestRes.json();

    // The fields a browser actually needs to consider a PWA installable
    // (per the MDN/Chromium installability criteria this ticket's own
    // "confirm the browser offers to install it" test step depends on).
    expect(manifest.name).toBe("GardenBedPlanner");
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);

    // At least one icon >= 192x192 (a real installability requirement,
    // not just "icons exist") and at least one maskable icon (Android's
    // adaptive-icon requirement).
    const hasLargeIcon = manifest.icons.some((icon: { sizes: string }) => {
      const [w, h] = icon.sizes.split("x").map(Number);
      return w >= 192 && h >= 192;
    });
    expect(hasLargeIcon, `no icon >= 192x192 in ${JSON.stringify(manifest.icons)}`).toBe(true);
    const hasMaskableIcon = manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable");
    expect(hasMaskableIcon, `no maskable-purpose icon in ${JSON.stringify(manifest.icons)}`).toBe(true);

    // Every referenced icon file must actually resolve, not just be listed.
    for (const icon of manifest.icons as { src: string }[]) {
      const iconRes = await page.request.get(new URL(icon.src, PREVIEW_URL).toString());
      expect(iconRes.ok(), `manifest icon ${icon.src} does not resolve (status ${iconRes.status()})`).toBeTruthy();
      expect((await iconRes.body()).length, `manifest icon ${icon.src} is empty`).toBeGreaterThan(0);
    }
  });

  test("theme_color/background_color pixel-match index.css's own light-mode --primary/--background tokens (#202)", async ({
    page,
  }) => {
    // Reuses the same rasterization technique terracotta-clay-color-
    // scheme.spec.ts (#188) established: setting a color as a canvas
    // fillStyle and reading back the actual rasterized pixel is the one
    // reliable way to compare two CSS color strings for real equality on
    // this Chromium build, since getComputedStyle preserves oklch(...)
    // notation verbatim rather than normalizing it. Proves the manifest's
    // hardcoded hex values are pixel-identical to the live CSS tokens,
    // not just "looks about right" from a manual OKLCH->sRGB conversion.
    await page.goto(PREVIEW_URL!);
    const manifestLink = page.locator('link[rel="manifest"]');
    const href = await manifestLink.getAttribute("href");
    const manifest = await (await page.request.get(new URL(href!, PREVIEW_URL).toString())).json();

    async function resolvedRgba(colorValue: string): Promise<[number, number, number, number]> {
      return page.evaluate((val) => {
        // Resolve any var(--token) reference through the real DOM cascade
        // first - canvas has no notion of CSS custom properties.
        const probe = document.createElement("div");
        probe.style.color = val;
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        document.body.removeChild(probe);

        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = computed;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a] as [number, number, number, number];
      }, colorValue);
    }

    const primaryRgba = await resolvedRgba("var(--primary)");
    const themeColorRgba = await resolvedRgba(manifest.theme_color);
    expect(themeColorRgba, `manifest.theme_color (${manifest.theme_color}) must resolve to the same pixel as --primary`).toEqual(primaryRgba);

    const backgroundRgba = await resolvedRgba("var(--background)");
    const manifestBackgroundRgba = await resolvedRgba(manifest.background_color);
    expect(
      manifestBackgroundRgba,
      `manifest.background_color (${manifest.background_color}) must resolve to the same pixel as --background`,
    ).toEqual(backgroundRgba);
  });

  test("the apple-touch-icon link (needed for iOS 'Add to Home Screen', per this ticket's own note) resolves to a real file", async ({
    page,
  }) => {
    await page.goto(PREVIEW_URL!);
    const appleIconLink = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIconLink).toHaveCount(1);
    const href = await appleIconLink.getAttribute("href");
    expect(href).toBeTruthy();

    const res = await page.request.get(new URL(href!, PREVIEW_URL).toString());
    expect(res.ok(), `apple-touch-icon ${href} does not resolve`).toBeTruthy();
    expect((await res.body()).length).toBeGreaterThan(0);
  });

  test("a real service worker registers and reaches the 'activated' state", async ({ page }) => {
    await page.goto(PREVIEW_URL!);

    const supported = await page.evaluate(() => "serviceWorker" in navigator);
    expect(supported, "this browser doesn't support service workers at all").toBe(true);

    // `navigator.serviceWorker.ready` can resolve a beat before the active
    // worker's own `.state` property has settled from "activating" to
    // "activated" (a real, observed race, not a hypothetical) - poll
    // briefly rather than reading the state exactly once right after
    // `ready` resolves.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.ready;
            return reg.active?.state ?? null;
          }),
        { message: "service worker never reached the 'activated' state" },
      )
      .toBe("activated");
  });
});
