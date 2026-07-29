import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #166 ("Layout canvas: bed/tree name labels
 * overlap and become illegible when beds are adjacent"). The implementer's
 * own outcome comment explicitly leaves visual verification for the tester
 * role ("no browser-automation tool available... please verify visually").
 *
 * Uses the app's DEFAULT_VIEWPORT (`{x: 0, y: 0, scale: 1}`, no "Fit view"
 * click) throughout - world-cm coordinates equal screen px exactly, so
 * there's no need to replicate any viewport/fitViewport math to predict
 * screen positions (unlike the handle-scaling specs, which learned this the
 * hard way - see `bed-transformer-handle-scaling.spec.ts`'s own doc
 * comment). Beds are placed well clear of the ruler's top-left tick-label
 * row (`y >= 100`) so `clampLabelYBelowRuler`'s own already-unit-tested
 * behavior (`labels.test.ts`) doesn't need re-proving here.
 *
 * Three things this spec checks:
 *  1. A bed too narrow for its full name gets an ellipsis-truncated label
 *     that never renders text past the bed's own right edge - directly
 *     measured via pixel-scanning for the label's text color
 *     (`#1f2937`, `BedNode.tsx`'s `fill`), the same real-pixel-compositing
 *     technique `ruler-tick-visibility.spec.ts` uses. This is the actual
 *     "adjacent beds must never have overlapping label glyphs" requirement
 *     verified directly (each label provably staying within its own bed's
 *     footprint means two adjacent beds' labels can't collide, by
 *     construction) rather than inferred.
 *  2. Hovering a truncated label shows the full, untruncated name via the
 *     shared `PlantingTooltip` (a real DOM element, not canvas-rendered -
 *     trivially locatable via `getByText`).
 *  3. A bed with a short name that fits comfortably does NOT trigger the
 *     tooltip on hover (`listening={isNameTruncated}` in `BedNode.tsx`
 *     gates the label's own hover handlers entirely when nothing was cut
 *     off) - confirms the truncation detection itself isn't a false
 *     positive that would spam every label with a redundant tooltip.
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

async function openBedsTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Beds" }).click();
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

const LABEL_TEXT_COLOR = { r: 31, g: 41, b: 55 }; // #1f2937, BedNode.tsx's label Text fill

/** Scans a rectangular CSS-pixel region for any pixel close to `target`
 * RGB, compositing every same-sized Konva layer canvas first - identical
 * technique to `ruler-tick-visibility.spec.ts`'s `regionContainsColor`. */
async function regionContainsColor(
  page: Page,
  cssX: number,
  cssY: number,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
  tolerance = 40,
): Promise<boolean> {
  return page.evaluate(
    ({ cssX, cssY, width, height, target, tolerance }) => {
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
          // Fully-transparent background pixels are (0,0,0,0) - without an
          // alpha check, black-ish transparent background falsely matches
          // any sufficiently-dark target color/tolerance combination (this
          // spec's own label-text-color scan hit exactly that trap: (0,0,0)
          // is within a tolerance-60 reach of #1f2937). Require the pixel
          // to be substantially opaque before it counts as real content.
          if (a < 200) continue;
          if (Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance) {
            return true;
          }
        }
      }
      return false;
    },
    { cssX, cssY, width, height, target, tolerance },
  );
}

test.describe("Bed name label truncation and hover tooltip (#166)", () => {
  let createdBedIds: number[] = [];

  test.beforeEach(() => {
    createdBedIds = [];
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdBedIds) {
      await request.delete(`/api/beds/${id}?cascade=true`).catch(() => {});
    }
  });

  test("a name too long for a narrow bed is truncated - never renders text past the bed's own right edge - and shows the full name on hover", async ({
    page,
    request,
  }) => {
    // 80cm wide (labelAvailableWidth = 80 - 2*4 = 72cm/px at fontSize 12) is
    // nowhere near enough for this name at Arial 12px - guaranteed truncation.
    const longName = "Large Planter One (Greenhouse Type, South-Facing)";
    const bed = await createBed(request, longName, rect(100, 100, 80, 150));
    createdBedIds.push(bed.id);

    await openBedsTab(page);
    const box = await canvasBox(page);

    // Confirm no label-colored pixel renders past the bed's own right edge
    // (world x=180, i.e. screen box.x+180 at scale=1) into the empty canvas
    // beyond it - the actual "must never overlap a neighbor" guarantee,
    // checked directly rather than inferred. A generous 60px-tall,
    // 200px-wide strip starting just past the edge easily covers where an
    // untruncated ~50-character label would have spilled to.
    const textPastRightEdge = await regionContainsColor(page, box.x + 181, box.y + 100, 200, 60, LABEL_TEXT_COLOR, 60);
    expect(textPastRightEdge, "label text rendered past the bed's own right edge - the width clamp isn't working").toBe(false);

    // Positive control: the label's own text color IS present somewhere
    // inside the bed's footprint - otherwise the "no text past the edge"
    // check above would trivially pass for the wrong reason (nothing
    // rendered at all).
    const textInsideBed = await regionContainsColor(page, box.x + 100, box.y + 100, 80, 30, LABEL_TEXT_COLOR, 60);
    expect(textInsideBed, "no label text found inside the bed at all - test setup problem, not a real pass").toBe(true);

    // Hover the label (top-left corner area, well within the truncated
    // label's own footprint) and confirm the tooltip shows the FULL,
    // untruncated name.
    await page.mouse.move(box.x + 120, box.y + 108);
    await expect(page.getByText(longName, { exact: true })).toBeVisible();
  });

  test("a name that fits comfortably is not truncated and does not trigger the hover tooltip", async ({ page, request }) => {
    const bed = await createBed(request, "Bed A", rect(400, 100, 300, 150));
    createdBedIds.push(bed.id);

    await openBedsTab(page);
    const box = await canvasBox(page);

    // Confirm the label's own text renders (positive control).
    const textInsideBed = await regionContainsColor(page, box.x + 400, box.y + 100, 300, 30, LABEL_TEXT_COLOR, 60);
    expect(textInsideBed, "no label text found inside the bed at all - test setup problem").toBe(true);

    // Hover directly over the label text - since it isn't truncated,
    // `listening={isNameTruncated}` means the label's own mouse handlers
    // are inert, so no tooltip should appear. `PlantingTooltip` renders as
    // a real DOM element with this exact class combination whenever any
    // tooltip is showing (see PlantingTooltip.tsx) - confirming its total
    // absence is a direct, unambiguous check (unlike trying to `getByText`
    // the bed's own name, which is canvas-rendered, not DOM, so would
    // never match regardless of whether a tooltip showed).
    await page.mouse.move(box.x + 420, box.y + 108);
    await page.waitForTimeout(200);
    await expect(page.locator(".pointer-events-none.absolute.z-10")).toHaveCount(0);
  });

  test("the read-only View mode applies the same truncation + hover-tooltip treatment (GardenSnapshotView)", async ({
    page,
    request,
  }) => {
    const longName = "Large Planter One (Greenhouse Type, South-Facing)";
    const bed = await createBed(request, longName, rect(100, 100, 80, 150));
    createdBedIds.push(bed.id);

    await openBedsTab(page);
    // Switch from Edit ("mine") to View ("example") mode - a separate
    // read-only Stage (GardenSnapshotView.tsx/GardenSnapshotLayer) sharing
    // the same `viewport` state, per Layout.tsx's `mode === "example"`
    // render branch.
    await page.getByRole("radio", { name: "View" }).click();
    await page.waitForTimeout(200);
    const box = await canvasBox(page);

    const textPastRightEdge = await regionContainsColor(page, box.x + 181, box.y + 100, 200, 60, LABEL_TEXT_COLOR, 60);
    expect(
      textPastRightEdge,
      "View mode: label text rendered past the bed's own right edge - the width clamp isn't working there",
    ).toBe(false);

    const textInsideBed = await regionContainsColor(page, box.x + 100, box.y + 100, 80, 30, LABEL_TEXT_COLOR, 60);
    expect(textInsideBed, "View mode: no label text found inside the bed at all - test setup problem").toBe(true);

    await page.mouse.move(box.x + 120, box.y + 108);
    await expect(page.getByText(longName, { exact: true })).toBeVisible();
  });
});
