import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #168 ("Mobile bottom nav: widest tab label
 * ('Notifications') touches/overflows the screen edge on every mobile
 * route") - the implementer's own outcome comment explicitly flagged the
 * ticket's own "How to test" steps (viewport-width-specific overflow
 * checks) as unverifiable in that environment (no browser-automation tool,
 * and no existing e2e spec measures this nav's own label bounding boxes).
 * `index-css-cleanup-regression.spec.ts` only confirms the mobile shell
 * renders *something* at a mobile viewport, not that its labels stay
 * inside the screen.
 */

const WIDTHS = [320, 375, 390] as const;
const NAV_LABELS = ["Home", "Agenda", "Seeds", "Logging", "Notifications"] as const;

async function gotoMobileHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible();
}

for (const width of WIDTHS) {
  test.describe(`Mobile bottom nav at ${width}px (#168)`, () => {
    test.use({ viewport: { width, height: 700 } });

    test(`no nav label crosses the screen edge, and every item stays visually even`, async ({ page }) => {
      await gotoMobileHome(page);

      const nav = page.getByRole("navigation");
      const navBox = await nav.boundingBox();
      expect(navBox, "nav bar has no bounding box").not.toBeNull();

      const links = nav.getByRole("link");
      await expect(links).toHaveCount(NAV_LABELS.length);

      const boxes: { x: number; width: number; height: number }[] = [];
      for (let i = 0; i < NAV_LABELS.length; i++) {
        const link = links.nth(i);
        await expect(link).toContainText(NAV_LABELS[i]);
        const box = await link.boundingBox();
        expect(box, `nav item "${NAV_LABELS[i]}" has no bounding box`).not.toBeNull();
        if (!box) continue;
        boxes.push(box);
        // Neither edge of any nav item's own box may sit outside the
        // physical viewport - the ticket's own core complaint.
        expect(box.x, `"${NAV_LABELS[i]}" starts left of the viewport at ${width}px`).toBeGreaterThanOrEqual(0);
        expect(
          box.x + box.width,
          `"${NAV_LABELS[i]}" extends past the right edge of the viewport at ${width}px`,
        ).toBeLessThanOrEqual(width + 0.5); // +0.5px float-rounding slack
      }

      // "Visually even": every column occupies the same width (flex-1,
      // evenly split) and the same height (shared padding/icon size) -
      // not just individually non-overflowing, per the ticket's own step 2.
      const widths = boxes.map((b) => Math.round(b.width));
      const heights = boxes.map((b) => Math.round(b.height));
      expect(new Set(widths).size, `nav items aren't evenly sized at ${width}px: ${widths.join(", ")}`).toBe(1);
      expect(new Set(heights).size, `nav items aren't the same height at ${width}px: ${heights.join(", ")}`).toBe(1);
    });

    test("active-tab styling still applies at this width", async ({ page }) => {
      await gotoMobileHome(page);
      const nav = page.getByRole("navigation");

      // Home is active by default (the "end" route match) - confirm via
      // the real aria-current NavLink sets, not a guessed class/color.
      const homeLink = nav.getByRole("link", { name: /Home/ });
      await expect(homeLink).toHaveAttribute("aria-current", "page");

      const agendaLink = nav.getByRole("link", { name: /Agenda/ });
      await expect(agendaLink).not.toHaveAttribute("aria-current", "page");

      await agendaLink.click();
      await expect(page).toHaveURL(/\/agenda$/);
      await expect(agendaLink).toHaveAttribute("aria-current", "page");
      await expect(homeLink).not.toHaveAttribute("aria-current", "page");
    });
  });
}
