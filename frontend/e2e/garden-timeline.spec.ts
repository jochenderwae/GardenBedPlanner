import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #180 ("The garden editor needs a timeline") -
 * the implementer's own outcome comment explicitly flags "visual/
 * interactive verification of the scrubber drag behavior and canvas dash/
 * opacity treatment" as unchecked (no browser-automation tool available at
 * implementation time), beyond what `plantingLifecycle.test.ts` already
 * covers at the pure-function level.
 *
 * Uses the app's DEFAULT_VIEWPORT (no "Fit view" click) throughout - see
 * `bed-label-overlap.spec.ts`'s own doc for why this sidesteps every
 * viewport/fitViewport-replica pitfalls the handle-scaling specs ran into.
 *
 * Marker-presence checks use `regionHasSaturatedColor` rather than matching
 * a specific RGB: `colorForSlug` (`geometry.ts`) derives an HSL hue from a
 * hash of the plant's own slug, which isn't worth replicating bit-for-bit
 * here - what actually matters for these scenarios is "is *a* colored
 * planting marker there or not," which a saturation check (real hue vs.
 * this app's neutral cream background/light-gray grid lines) answers
 * robustly regardless of which exact color a given slug happens to hash to.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

/** Mirrors `plantingLifecycle.ts`'s own `todayIsoDate()` (local calendar
 * date parts, not a UTC conversion) - an earlier version of this helper
 * used `toISOString().slice(0, 10)`, which converts to UTC first and can
 * land on a different calendar date than intended whenever this machine's
 * local timezone isn't UTC (confirmed the hard way: a "+12 days" planting
 * came back describing itself as something other than "12 days" once
 * rendered through the app's own local-date `describeRemovalSchedule`). */
function isoDaysFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", spread_cm: 30 },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  geometry: Rect,
  plantedDate: string | null,
  removedDate: string | null,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry, planted_date: plantedDate, removed_date: removedDate },
    params: { is_initial_state: true }, // backfilling history, not a live "just planted" event - skip task generation
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

/** True if any opaque, genuinely-saturated (non-grayscale) pixel exists in
 * the given region - see this file's own doc for why a saturation check is
 * used instead of matching a specific hash-derived hue. */
async function regionHasSaturatedColor(page: Page, cssX: number, cssY: number, width: number, height: number): Promise<boolean> {
  return page.evaluate(
    ({ cssX, cssY, width, height }) => {
      const all = Array.from(document.querySelectorAll("canvas"));
      const reference = all[0];
      if (!reference) return false;
      const refBox = reference.getBoundingClientRect();
      const layers = all.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left === refBox.left && b.top === refBox.top && b.width === refBox.width && b.height === refBox.height;
      });
      if (layers.length === 0) return false;
      const scratch = document.createElement("canvas");
      scratch.width = reference.width;
      scratch.height = reference.height;
      const sctx = scratch.getContext("2d");
      if (!sctx) return false;
      for (const layer of layers) sctx.drawImage(layer, 0, 0);
      const scaleX = reference.width / refBox.width;
      const scaleY = reference.height / refBox.height;
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const localX = Math.round((cssX + dx - refBox.left) * scaleX);
          const localY = Math.round((cssY + dy - refBox.top) * scaleY);
          if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) continue;
          const [r, g, b, a] = sctx.getImageData(localX, localY, 1, 1).data;
          if (a < 200) continue;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          if (saturation > 40) return true;
        }
      }
      return false;
    },
    { cssX, cssY, width, height },
  );
}

test.describe("Garden editor timeline (#180)", () => {
  test("View tab's date scrubber shows real garden data, filtered by the chosen as-of date", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, "E2E Timeline Bed", rect(100, 100, 300, 200));
    const slug = `e2e-timeline-plant-${stamp}`;
    await createPlant(request, slug, `E2E Timeline Plant ${stamp}`);

    // A long-past planting: planted 60 days ago, removed 30 days ago - not
    // active today, but was active ~45 days ago.
    const pastGeom = rect(20, 20, 30, 30);
    const past = await createPlanting(request, bed.id, slug, pastGeom, isoDaysFromToday(-60), isoDaysFromToday(-30));

    // A currently-active planting, planted today, no removal scheduled.
    const currentGeom = rect(150, 100, 30, 30);
    const current = await createPlanting(request, bed.id, slug, currentGeom, isoDaysFromToday(0), null);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("radio", { name: "View" }).click();

      const box = await canvasBox(page);

      // Default as-of date is today.
      const asOfInput = page.getByLabel("As-of date");
      await expect(asOfInput).toHaveValue(isoDaysFromToday(0));
      await expect(page.getByText("(today)")).toBeVisible();

      // Today: the current planting's marker (world (165,115), center of
      // its 30x30 footprint at bed (100,100) + local (150,100)+15) should
      // render; the past one (world (135,135)) should not.
      const currentCenter = { x: 100 + 150 + 15, y: 100 + 100 + 15 };
      const pastCenter = { x: 100 + 20 + 15, y: 100 + 20 + 15 };

      await expect
        .poll(async () => regionHasSaturatedColor(page, box.x + currentCenter.x - 10, box.y + currentCenter.y - 10, 20, 20), {
          message: "the currently-active planting's marker never rendered on the View tab",
          timeout: 5000,
        })
        .toBe(true);
      expect(
        await regionHasSaturatedColor(page, box.x + pastCenter.x - 10, box.y + pastCenter.y - 10, 20, 20),
        "the long-past planting's marker rendered today, even though it was removed 30 days ago",
      ).toBe(false);

      // Scrub back 45 days: the past planting was active then (planted -60,
      // removed -30), the current one wasn't planted yet (planted 0).
      await asOfInput.fill(isoDaysFromToday(-45));
      await asOfInput.blur();

      await expect(page.getByText("(today)")).toHaveCount(0);
      await expect
        .poll(async () => regionHasSaturatedColor(page, box.x + pastCenter.x - 10, box.y + pastCenter.y - 10, 20, 20), {
          message: "the long-past planting's marker never rendered when scrubbed to a date it was actually active",
          timeout: 5000,
        })
        .toBe(true);
      expect(
        await regionHasSaturatedColor(page, box.x + currentCenter.x - 10, box.y + currentCenter.y - 10, 20, 20),
        "the current planting's marker rendered 45 days before it was ever planted",
      ).toBe(false);

      // The "Today" button jumps straight back.
      await page.getByRole("button", { name: "Today" }).click();
      await expect(asOfInput).toHaveValue(isoDaysFromToday(0));
    } finally {
      await request.delete(`/api/plantings/${past.id}`).catch(() => {});
      await request.delete(`/api/plantings/${current.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("Edit tab: a future-dated removal stays visible today; a past removal disappears entirely", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, "E2E Timeline Edit Bed", rect(100, 100, 300, 200));
    const slug = `e2e-timeline-edit-plant-${stamp}`;
    await createPlant(request, slug, `E2E Timeline Edit Plant ${stamp}`);

    const scheduledGeom = rect(20, 20, 30, 30);
    const scheduled = await createPlanting(request, bed.id, slug, scheduledGeom, isoDaysFromToday(-10), isoDaysFromToday(30));
    const goneGeom = rect(150, 100, 30, 30);
    const gone = await createPlanting(request, bed.id, slug, goneGeom, isoDaysFromToday(-60), isoDaysFromToday(-1));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();
      await page.getByRole("tab", { name: "Plants" }).click();

      const box = await canvasBox(page);
      const scheduledCenter = { x: 100 + 20 + 15, y: 100 + 20 + 15 };
      const goneCenter = { x: 100 + 150 + 15, y: 100 + 100 + 15 };

      await expect
        .poll(async () => regionHasSaturatedColor(page, box.x + scheduledCenter.x - 10, box.y + scheduledCenter.y - 10, 20, 20), {
          message: "a planting with a future removed_date (scheduled) should still render on the Edit tab today",
          timeout: 5000,
        })
        .toBe(true);
      expect(
        await regionHasSaturatedColor(page, box.x + goneCenter.x - 10, box.y + goneCenter.y - 10, 20, 20),
        "a planting whose removed_date already passed should not render on the Edit tab at all",
      ).toBe(false);
    } finally {
      await request.delete(`/api/plantings/${scheduled.id}`).catch(() => {});
      await request.delete(`/api/plantings/${gone.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("BedPanel's History section lists past plantings, and PlantingPanel shows a 'scheduled to be cleared' countdown", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, "E2E Timeline History Bed", rect(100, 100, 300, 200));
    const slug = `e2e-timeline-history-plant-${stamp}`;
    const commonName = `E2E Timeline History Plant ${stamp}`;
    await createPlant(request, slug, commonName);

    const pastGeom = rect(20, 20, 30, 30);
    const past = await createPlanting(request, bed.id, slug, pastGeom, isoDaysFromToday(-90), isoDaysFromToday(-60));
    const scheduledGeom = rect(150, 100, 30, 30);
    const scheduled = await createPlanting(request, bed.id, slug, scheduledGeom, isoDaysFromToday(-5), isoDaysFromToday(12));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      // Open the bed panel via a plain click on the bed's interior.
      const box = await canvasBox(page);
      await page.mouse.click(box.x + 105, box.y + 250); // inside the bed, clear of both plantings
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      await expect(page.getByText("History", { exact: true })).toBeVisible();
      const historyEntry = page.locator("li", { hasText: commonName });
      await expect(historyEntry).toBeVisible();
      await expect(historyEntry).toContainText(isoDaysFromToday(-90));
      await expect(historyEntry).toContainText(isoDaysFromToday(-60));
      // Only the past (already-removed) planting is listed - not the
      // still-active, scheduled-to-leave one.
      await expect(page.locator("li", { hasText: commonName })).toHaveCount(1);

      // Now open the still-active, scheduled-to-leave planting's own panel
      // and confirm the countdown text.
      await page.getByRole("tab", { name: "Plants" }).click();
      // Re-measure the canvas box rather than reusing the one captured
      // above: it was sampled while BedPanel was still closed (full canvas
      // width), and closing BedPanel by navigating away doesn't necessarily
      // settle back to the exact same box synchronously - re-measuring
      // after the tab switch (and BedPanel's unmount) is what actually
      // matches the click coordinates below to reality (confirmed the hard
      // way: reusing the stale box consistently missed the marker
      // entirely, no panel ever opened).
      const boxAfterPanelClose = await canvasBox(page);
      // scheduledGeom = rect(150,100,30,30) bed-local, bed at world
      // (100,100) -> center (100+150+15, 100+100+15) = (265, 215).
      await page.mouse.click(boxAfterPanelClose.x + 265, boxAfterPanelClose.y + 215);
      await expect(page.getByText("Scheduled to be cleared in 12 days")).toBeVisible();
    } finally {
      await request.delete(`/api/plantings/${past.id}`).catch(() => {});
      await request.delete(`/api/plantings/${scheduled.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
