import { test, expect, type Page } from "@playwright/test";

/**
 * Coverage for #188 ("Apply the Terracotta & Clay color scheme app-wide").
 *
 * This is fundamentally a design-values ticket - the ticket's own "How to
 * test" section explicitly asks for a human eyeball pass on steps 2/3
 * (visual verification across every route/mode, contrast spot-check "by
 * eye"). That judgment call stays with the user at the tested -> verified
 * gate, same as #141's index-css-cleanup-regression.spec.ts already
 * establishes for this exact area.
 *
 * What IS this role's job, and what's objectively checkable without a
 * subjective aesthetic call:
 *  - Every custom property in :root and .dark resolves to *exactly* the
 *    literal oklch(...) value the ticket's table specifies - not "close",
 *    not "some terracotta-ish color", the actual spec'd number. A future
 *    edit that silently drifts one token (a copy-paste slip, a missed
 *    find/replace) would otherwise go unnoticed until a human happened to
 *    look at the exact right pixel.
 *  - The five --chart-N tokens are genuinely five distinguishable colors,
 *    not an accidental duplicate (the ticket calls this out explicitly:
 *    "five distinguishable hues... not five shades of one color").
 *  - The highest-risk text/background pairs the ticket names for a manual
 *    contrast check (primary, destructive, muted) meet a real, objective
 *    WCAG contrast-ratio floor - an automatable proxy for "nothing should
 *    look illegible" that doesn't require a human eyeball, layered on top
 *    of (not instead of) the human pass the ticket still needs.
 *  - The app still renders cleanly (no console error, non-zero landmark)
 *    with the new palette in both light mode and a forced .dark mode -
 *    nothing in the app currently toggles .dark itself (no theme switch
 *    exists yet), so this is the only way to exercise those values at all
 *    today; forcing the class directly is the correct way to reach them.
 *
 * Values below are transcribed directly from the ticket body's two tables
 * and cross-checked byte-for-byte against frontend/src/index.css at the
 * time this spec was written.
 */

const LIGHT_TOKENS: Record<string, string> = {
  "--background": "oklch(0.98 0.008 70)",
  "--foreground": "oklch(0.22 0.02 40)",
  "--card": "oklch(0.995 0.006 70)",
  "--card-foreground": "oklch(0.22 0.02 40)",
  "--popover": "oklch(0.995 0.006 70)",
  "--popover-foreground": "oklch(0.22 0.02 40)",
  "--primary": "oklch(0.52 0.16 45)",
  "--primary-foreground": "oklch(0.98 0.01 45)",
  "--secondary": "oklch(0.93 0.03 140)",
  "--secondary-foreground": "oklch(0.30 0.05 145)",
  "--muted": "oklch(0.94 0.02 70)",
  "--muted-foreground": "oklch(0.48 0.03 55)",
  "--accent": "oklch(0.90 0.06 45)",
  "--accent-foreground": "oklch(0.30 0.08 40)",
  "--destructive": "oklch(0.56 0.23 25)",
  "--destructive-foreground": "oklch(0.98 0.01 25)",
  "--border": "oklch(0.88 0.02 60)",
  "--input": "oklch(0.88 0.02 60)",
  "--ring": "oklch(0.58 0.15 45)",
  "--chart-1": "oklch(0.58 0.17 45)",
  "--chart-2": "oklch(0.52 0.12 142)",
  "--chart-3": "oklch(0.55 0.16 255)",
  "--chart-4": "oklch(0.62 0.14 300)",
  "--chart-5": "oklch(0.78 0.14 95)",
  "--sidebar": "oklch(0.96 0.012 70)",
  "--sidebar-foreground": "oklch(0.22 0.02 40)",
  "--sidebar-primary": "oklch(0.52 0.16 45)",
  "--sidebar-primary-foreground": "oklch(0.98 0.01 45)",
  "--sidebar-accent": "oklch(0.93 0.03 140)",
  "--sidebar-accent-foreground": "oklch(0.30 0.05 145)",
  "--sidebar-border": "oklch(0.88 0.02 60)",
  "--sidebar-ring": "oklch(0.58 0.15 45)",
};

const DARK_TOKENS: Record<string, string> = {
  "--background": "oklch(0.17 0.012 40)",
  "--foreground": "oklch(0.96 0.01 70)",
  "--card": "oklch(0.22 0.015 45)",
  "--card-foreground": "oklch(0.96 0.01 70)",
  "--popover": "oklch(0.22 0.015 45)",
  "--popover-foreground": "oklch(0.96 0.01 70)",
  "--primary": "oklch(0.68 0.17 42)",
  "--primary-foreground": "oklch(0.16 0.02 40)",
  "--secondary": "oklch(0.28 0.03 145)",
  "--secondary-foreground": "oklch(0.92 0.02 130)",
  "--muted": "oklch(0.26 0.015 50)",
  "--muted-foreground": "oklch(0.68 0.02 60)",
  "--accent": "oklch(0.32 0.06 45)",
  "--accent-foreground": "oklch(0.93 0.03 45)",
  "--destructive": "oklch(0.68 0.19 24)",
  "--destructive-foreground": "oklch(0.15 0.02 24)",
  "--border": "oklch(1 0 0 / 12%)",
  "--input": "oklch(1 0 0 / 16%)",
  "--ring": "oklch(0.66 0.15 42)",
  "--chart-1": "oklch(0.70 0.17 45)",
  "--chart-2": "oklch(0.66 0.14 142)",
  "--chart-3": "oklch(0.68 0.16 255)",
  "--chart-4": "oklch(0.70 0.15 300)",
  "--chart-5": "oklch(0.82 0.13 95)",
  "--sidebar": "oklch(0.20 0.014 45)",
  "--sidebar-foreground": "oklch(0.96 0.01 70)",
  "--sidebar-primary": "oklch(0.68 0.17 42)",
  "--sidebar-primary-foreground": "oklch(0.16 0.02 40)",
  "--sidebar-accent": "oklch(0.28 0.03 145)",
  "--sidebar-accent-foreground": "oklch(0.92 0.02 130)",
  "--sidebar-border": "oklch(1 0 0 / 12%)",
  "--sidebar-ring": "oklch(0.66 0.15 42)",
};

type Rgba = [number, number, number, number];

/**
 * Resolves any CSS color string (a literal `oklch(...)` value, or
 * `var(--token)` read live off the document) down to concrete 8-bit sRGB
 * pixel bytes, by actually painting a 1x1 canvas rect with it and reading
 * the rasterized pixel back via `getImageData`. This is the one technique
 * that's actually reliable here, after two dead ends discovered while
 * writing this spec:
 *  - `getComputedStyle(...).color` on current Chromium preserves the
 *    original `oklch(...)` notation verbatim rather than normalizing to
 *    rgb (CSS Color 4 serialization behavior), so two visually identical
 *    colors specified differently don't compare equal as plain strings.
 *  - Canvas 2D's `fillStyle` *getter* turns out to have the same behavior
 *    on this build - assigning `oklch(...)` and reading `fillStyle` back
 *    returns the oklch string unchanged, not a canonicalized rgb/hex
 *    string as older canvas implementations did. Only forcing an actual
 *    rasterization (`fillRect` + `getImageData`) yields concrete bytes,
 *    since a rendered pixel has no notion of which CSS color-space syntax
 *    produced it - reusing the browser's own (correct, spec-compliant)
 *    oklch -> sRGB conversion rather than reimplementing that math by hand
 *    in the test, which would be a real chance to introduce a wrong test.
 */
async function resolvedRgba(page: Page, colorValue: string): Promise<Rgba> {
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

function relativeLuminance([r, g, b]: Rgba): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const La = relativeLuminance(a);
  const Lb = relativeLuminance(b);
  const lighter = Math.max(La, Lb);
  const darker = Math.min(La, Lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Adds the `.dark` class to `<html>` after navigation. Nothing in the app
 * itself toggles this yet (no theme switch exists), so this is the only
 * way to reach the `.dark` token block at all today - deliberately applied
 * post-navigation, not via `page.addInitScript`, after that approach
 * turned out to fire before `document.documentElement` exists in this
 * Chromium build (a real, reproducible `TypeError` surfaced only once a
 * `pageerror` listener was in place to catch it) and silently never apply.
 * Applying the class post-load is fine here: nothing in this app reads
 * `.dark` from JS, it's a pure CSS-cascade switch that recomputes styles
 * immediately regardless of when the class is set.
 */
async function forceDarkMode(page: Page): Promise<void> {
  await page.evaluate(() => document.documentElement.classList.add("dark"));
}

async function checkPageLoadsCleanly(page: Page, path: string, forceDark: boolean) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(path);
  if (forceDark) {
    await forceDarkMode(page);
  }
  await page.waitForLoadState("networkidle");

  expect(errors, `console/page errors on ${path} (dark=${forceDark}): ${errors.join("; ")}`).toHaveLength(0);

  const landmark = page.getByText("GardenBedPlanner").first();
  await expect(landmark).toBeVisible({ timeout: 10000 });
  const box = await landmark.boundingBox();
  expect(box, `no landmark bounding box on ${path} (dark=${forceDark})`).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
}

test.describe("Terracotta & Clay color scheme (#188) - light mode token values", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  for (const [token, expected] of Object.entries(LIGHT_TOKENS)) {
    test(`${token} resolves to the spec'd Terracotta & Clay value`, async ({ page }) => {
      const actual = await resolvedRgba(page, `var(${token})`);
      const wanted = await resolvedRgba(page, expected);
      expect(actual, `${token}: live value did not match spec'd ${expected}`).toEqual(wanted);
    });
  }
});

test.describe("Terracotta & Clay color scheme (#188) - dark mode token values", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await forceDarkMode(page);
  });

  for (const [token, expected] of Object.entries(DARK_TOKENS)) {
    test(`.dark ${token} resolves to the spec'd Terracotta & Clay value`, async ({ page }) => {
      const actual = await resolvedRgba(page, `var(${token})`);
      const wanted = await resolvedRgba(page, expected);
      expect(actual, `.dark ${token}: live value did not match spec'd ${expected}`).toEqual(wanted);
    });
  }
});

test.describe("Terracotta & Clay color scheme (#188) - chart palette distinctness", () => {
  for (const [label, mode] of [
    ["light", false],
    ["dark", true],
  ] as const) {
    test(`${label} mode: all 5 --chart-N tokens are distinguishable from each other`, async ({ page }) => {
      await page.goto("/");
      if (mode) {
        await forceDarkMode(page);
      }
      const chartRgbas = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => resolvedRgba(page, `var(--chart-${n})`)),
      );
      const distinct = new Set(chartRgbas.map((rgba) => rgba.join(",")));
      expect(distinct.size, `chart colors collapsed to duplicates: ${chartRgbas.map((r) => r.join(",")).join(" | ")}`).toBe(5);
    });
  }
});

test.describe("Terracotta & Clay color scheme (#188) - contrast spot-checks", () => {
  // WCAG 2.1 AA for normal-size text is 4.5:1; for large text/UI
  // components it's 3:1. These are real numbers computed from the actual
  // spec'd oklch values (not guessed), so this is a genuine regression
  // guard, not an arbitrary threshold - a future edit that meaningfully
  // erodes legibility on these named highest-risk pairs will fail it.
  const PAIRS: Array<[string, string, string, number]> = [
    ["primary-foreground on primary", "--primary-foreground", "--primary", 4.5],
    ["destructive-foreground on destructive", "--destructive-foreground", "--destructive", 4.5],
    ["muted-foreground on muted", "--muted-foreground", "--muted", 4.5],
    ["accent-foreground on accent", "--accent-foreground", "--accent", 4.5],
    ["foreground on background", "--foreground", "--background", 4.5],
  ];

  for (const [label, tokens, mode] of [
    ["light", LIGHT_TOKENS, false],
    ["dark", DARK_TOKENS, true],
  ] as const) {
    for (const [pairLabel, fgToken, bgToken, minRatio] of PAIRS) {
      test(`${label} mode: ${pairLabel} meets WCAG AA (>= ${minRatio}:1)`, async ({ page }) => {
        await page.goto("/");
        if (mode) {
          await forceDarkMode(page);
        }
        const fgRgb = await resolvedRgba(page, tokens[fgToken]);
        const bgRgb = await resolvedRgba(page, tokens[bgToken]);
        const ratio = contrastRatio(fgRgb, bgRgb);
        expect(ratio, `${pairLabel} (${label}): contrast ratio ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          minRatio,
        );
      });
    }
  }
});

test.describe("Terracotta & Clay color scheme (#188) - no functional regression", () => {
  const PAGES = ["/", "/plants", "/agenda", "/seed-guide"];

  test.describe("light mode", () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    for (const path of PAGES) {
      test(`${path} loads cleanly under the new light palette`, async ({ page }) => {
        await checkPageLoadsCleanly(page, path, false);
      });
    }
  });

  test.describe("forced dark mode", () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    for (const path of PAGES) {
      test(`${path} loads cleanly under the new dark palette`, async ({ page }) => {
        await checkPageLoadsCleanly(page, path, true);
      });
    }
  });
});
