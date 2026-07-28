import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #129 ("Fix GardenBoundary rotate/resize
 * handles shrinking to invisible dots when zoomed out") - mirrors #71's
 * identical fix for `BedNode.tsx`. The implementer's own outcome comment
 * explicitly leaves the interactive zoom/drag verification for the tester
 * role.
 *
 * Two things this spec checks, at both a near-1x and a heavily-zoomed-out
 * scale:
 *  1. Functional: the resize handle is genuinely grabbable and a drag on it
 *     actually resizes the boundary.
 *  2. Size: the handle's on-screen pixel size stays roughly constant across
 *     zoom levels, not ballooning or shrinking - the actual bug #129 was
 *     filed for. The very first tester pass on this ticket only checked (1),
 *     which a ballooned handle still satisfies - see #71's own regression
 *     spec's doc comment for the fuller history of that gap.
 *
 * Targets the *resize* handle (not the rotate handle): its screen position
 * is unambiguous - exactly at the rect's own edge midpoint, no extra
 * offset to reverse-engineer - while both anchor types are governed by the
 * exact same `anchorSize`/`anchorStrokeWidth` fix this ticket is actually
 * about. A debug screenshot taken while building the original version of
 * this spec confirmed the rotate handle is also present and reasonably
 * sized at this same zoom level (not an invisible dot), but its exact
 * on-screen position relative to the shape didn't match the naive
 * "directly above top-center" formula `compass-widget.spec.ts` used
 * successfully for a *symmetric* proxy circle - Konva's default
 * single-rectangle Transformer appears to position it differently, and
 * chasing the exact formula further wasn't worth it against a resize-handle
 * test that already exercises the identical size-fix code path precisely.
 *
 * Locating the handle's expected screen position (2026-07-28 rewrite, same
 * fix as `bed-transformer-handle-scaling.spec.ts`'s equivalent rewrite):
 * scale comes straight from the toolbar's own zoom readout (ground truth,
 * not a locally hand-replicated `fitViewport` formula, which was
 * measurably, deterministically off). The pan offset still needs local
 * replication (Konva doesn't expose it) and must account for
 * `CompassWidget.tsx`'s `compassBoundingBox`, which `handleFitView`
 * (`Layout.tsx`) always includes in the fitted content extent alongside the
 * garden boundary, regardless of active tab - it sits far enough outside
 * the garden boundary (right side, and above the top edge) to meaningfully
 * shift the offset if omitted. The original version of this spec (which
 * only asserted functional grabbability, not measured size) happened to
 * pass anyway because the drag gesture's start point only needed to be
 * "close enough" to register as a drag on *some* draggable node; the
 * stricter size-measurement assertion added here would not have tolerated
 * that same drift, which is exactly the class of gap flagged above.
 *
 * Measurement technique: identical to `bed-transformer-handle-scaling.spec.ts`
 * - Konva's Transformer anchors default to `stroke: 'rgb(0, 161, 255)'`
 * (confirmed in `node_modules/konva/lib/shapes/Transformer.js`), which
 * nothing else in this app's canvas rendering uses. Composites every
 * same-sized Konva `<canvas>` layer and scans a small square region around
 * the expected handle center for that exact blue.
 *
 * Same Garden-row cleanup caveat as every other Garden-creating spec in
 * this directory (no `DELETE /api/garden` route exists) - clear
 * `garden_test`'s `garden` table manually after running this file.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

function worldToScreen(point: Point, viewport: { x: number; y: number; scale: number }): Point {
  return { x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y };
}

// Mirrors CompassWidget.tsx's compassBoundingBox exactly (values copied
// from its own constants - not importable across the e2e/src boundary).
const COMPASS_RADIUS_CM = 36;
const COMPASS_MARGIN_CM = 50;
const ABOVE_RING_HEADROOM_CM = 36 + 15 + 12 * 1.2 + 10 - 36 + 8; // = 47.4
function compassBoundingBox(gardenBounds: Box): Box {
  const center = { x: gardenBounds.x + gardenBounds.width + COMPASS_MARGIN_CM, y: gardenBounds.y + COMPASS_RADIUS_CM };
  return {
    x: center.x - COMPASS_RADIUS_CM,
    y: center.y - COMPASS_RADIUS_CM - ABOVE_RING_HEADROOM_CM,
    width: COMPASS_RADIUS_CM * 2,
    height: COMPASS_RADIUS_CM * 2 + ABOVE_RING_HEADROOM_CM,
  };
}

async function putGarden(request: APIRequestContext, geometry: Rect): Promise<{ id: number }> {
  const res = await request.put("/api/garden", { data: { name: "E2E Boundary Handle Garden", border_geometry: geometry } });
  expect(res.ok(), `failed to PUT garden: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Deletes every bed, not just the auto-created "Ground" one - any bed
 * left over from another spec sharing `garden_test` (e.g.
 * `bed-transformer-handle-scaling.spec.ts`'s own beds, some placed far
 * outside this file's small test gardens) would otherwise get pulled into
 * `handleFitView`'s content extent and badly skew the computed scale,
 * exactly the failure mode that motivated this rewrite in the first
 * place. */
async function deleteAllBeds(request: APIRequestContext): Promise<void> {
  const beds = await (await request.get("/api/beds")).json();
  for (const b of beds as { id: number }[]) {
    await request.delete(`/api/beds/${b.id}?cascade=true`).catch(() => {});
  }
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

const KONVA_ANCHOR_BLUE = { r: 0, g: 161, b: 255 };

/** Identical to `bed-transformer-handle-scaling.spec.ts`'s function of the
 * same name - see its own doc comment for the full rationale. */
async function measureHandleWidthPx(
  page: Page,
  centerCssX: number,
  centerCssY: number,
  radiusPx: number,
): Promise<number | null> {
  return page.evaluate(
    ({ centerCssX, centerCssY, radiusPx, target }) => {
      const all = Array.from(document.querySelectorAll("canvas"));
      const reference = all[0];
      if (!reference) return null;
      const refBox = reference.getBoundingClientRect();
      const layers = all.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left === refBox.left && b.top === refBox.top && b.width === refBox.width && b.height === refBox.height;
      });
      if (layers.length === 0) return null;

      const scratch = document.createElement("canvas");
      scratch.width = reference.width;
      scratch.height = reference.height;
      const sctx = scratch.getContext("2d");
      if (!sctx) return null;
      for (const layer of layers) sctx.drawImage(layer, 0, 0);

      const scaleX = reference.width / refBox.width;
      const scaleY = reference.height / refBox.height;
      const tolerance = 30;
      let minDx: number | null = null;
      let maxDx: number | null = null;
      let minDy: number | null = null;
      let maxDy: number | null = null;
      for (let dy = -radiusPx; dy <= radiusPx; dy++) {
        const localY = Math.round((centerCssY + dy - refBox.top) * scaleY);
        if (localY < 0 || localY >= scratch.height) continue;
        for (let dx = -radiusPx; dx <= radiusPx; dx++) {
          const localX = Math.round((centerCssX + dx - refBox.left) * scaleX);
          if (localX < 0 || localX >= scratch.width) continue;
          const [r, g, b] = sctx.getImageData(localX, localY, 1, 1).data;
          if (Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance) {
            minDx = minDx === null ? dx : Math.min(minDx, dx);
            maxDx = maxDx === null ? dx : Math.max(maxDx, dx);
            minDy = minDy === null ? dy : Math.min(minDy, dy);
            maxDy = maxDy === null ? dy : Math.max(maxDy, dy);
          }
        }
      }
      if (minDx === null || maxDx === null || minDy === null || maxDy === null) return null;
      return Math.max(maxDx - minDx, maxDy - minDy);
    },
    { centerCssX, centerCssY, radiusPx, target: KONVA_ANCHOR_BLUE },
  );
}

/** Sets up a garden (no beds), fits the view, and returns the real toolbar
 * scale plus the measured screen-pixel size of the boundary's right-middle
 * resize handle. */
async function measureAtScenario(
  page: Page,
  request: APIRequestContext,
  gardenBox: Box,
  radiusPx: number,
): Promise<{ widthPx: number | null; scale: number; box: Box; expectedViewport: { x: number; y: number; scale: number } }> {
  await putGarden(request, { type: "rectangle", rotation: 0, ...gardenBox });
  await deleteAllBeds(request);

  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) await startFromScratch.click();
  await page.getByRole("tab", { name: "Garden" }).click();
  await page.waitForTimeout(300); // let ResizeObserver-driven canvasSize settle before Fit view

  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);

  const box = await canvasBox(page);
  const canvasSize = { width: box.width, height: box.height };
  const zoomText = await page.locator("text=/^\\d+%$/").first().textContent();
  const actualScale = Number(zoomText?.replace("%", "")) / 100;
  const marginPx = 40;
  const availableWidth = Math.max(1, canvasSize.width - marginPx * 2);
  const availableHeight = Math.max(1, canvasSize.height - marginPx * 2);

  const compassBox = compassBoundingBox(gardenBox);
  const allBoxes = [gardenBox, compassBox];
  const minX = Math.min(...allBoxes.map((b) => b.x));
  const minY = Math.min(...allBoxes.map((b) => b.y));
  const maxX = Math.max(...allBoxes.map((b) => b.x + b.width));
  const maxY = Math.max(...allBoxes.map((b) => b.y + b.height));
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const expectedViewport = {
    scale: actualScale,
    x: marginPx + (availableWidth - contentWidth * actualScale) / 2 - minX * actualScale,
    y: marginPx + (availableHeight - contentHeight * actualScale) / 2 - minY * actualScale,
  };

  // No click-to-select needed: GardenBoundary.tsx's own `isSelected` prop
  // is wired directly to `tab === "garden"` (Layout.tsx), not a separate
  // click-driven selection state the way beds have - the Transformer is
  // already attached the moment the Garden tab is active.
  const handleWorld = { x: gardenBox.width, y: gardenBox.height / 2 };
  const handleScreen = worldToScreen(handleWorld, expectedViewport);
  const widthPx = await measureHandleWidthPx(page, box.x + handleScreen.x, box.y + handleScreen.y, radiusPx);

  return { widthPx, scale: actualScale, box, expectedViewport };
}

test.describe("Garden boundary rotate/resize handles at multiple zoom levels (#129)", () => {
  test("the resize handle is grabbable/functional and stays a roughly constant on-screen size, not ballooning or shrinking with zoom", async ({
    page,
    request,
  }) => {
    try {
      // Scenario A: near-1x - garden nearly matches the canvas.
      const near1 = await measureAtScenario(page, request, { x: 0, y: 0, width: 800, height: 600 }, 12);
      expect(near1.scale).toBeGreaterThan(0.5); // sanity: really is "not zoomed out"

      // Scenario B: heavily zoomed out - the exact regime #129's bug report
      // was about.
      const zoomedOut = await measureAtScenario(page, request, { x: 0, y: 0, width: 8000, height: 6000 }, 12);
      expect(zoomedOut.scale).toBeLessThan(0.3); // sanity: really is "zoomed out"

      console.log(
        `[garden-boundary-handle-scaling] near-1x scale=${near1.scale.toFixed(3)} handle size=${near1.widthPx}px | ` +
          `zoomed-out scale=${zoomedOut.scale.toFixed(3)} handle size=${zoomedOut.widthPx}px`,
      );

      expect(near1.widthPx, "resize handle wasn't found (invisible/mispositioned) at the near-1x baseline").not.toBeNull();
      expect(zoomedOut.widthPx, "resize handle wasn't found (invisible/mispositioned) at the zoomed-out scale").not.toBeNull();

      const a = near1.widthPx as number;
      const b = zoomedOut.widthPx as number;
      // Same generous 2.5x tolerance as bed-transformer-handle-scaling.spec.ts
      // - distinguishes "working as intended" from a real ballooning/
      // shrinking regression, which product-owner's report describes as
      // handles growing to "a huge size", not a marginal drift.
      expect(
        b / a,
        `resize handle size should stay roughly constant across zoom levels (measured ${a}px near 1x scale vs ` +
          `${b}px zoomed out) - a large ratio here is exactly the #129 ballooning/shrinking regression`,
      ).toBeGreaterThan(1 / 2.5);
      expect(
        b / a,
        `resize handle size should stay roughly constant across zoom levels (measured ${a}px near 1x scale vs ` +
          `${b}px zoomed out) - a large ratio here is exactly the #129 ballooning/shrinking regression`,
      ).toBeLessThan(2.5);

      // Functional check at the zoomed-out scale (the regime the original
      // bug report - "shrinking to invisible dots" - was about): drag the
      // handle and confirm the boundary's width actually changes server-side.
      const handleWorld = { x: 8000, y: 3000 };
      const handleScreen = worldToScreen(handleWorld, zoomedOut.expectedViewport);
      const handlePageX = zoomedOut.box.x + handleScreen.x;
      const handlePageY = zoomedOut.box.y + handleScreen.y;

      await page.mouse.move(handlePageX, handlePageY);
      await page.mouse.down();
      await page.mouse.move(handlePageX + 100, handlePageY, { steps: 15 });
      await page.mouse.up();

      await expect
        .poll(
          async () => {
            const garden = await (await request.get("/api/garden")).json();
            return garden.border_geometry.width;
          },
          { message: "garden boundary resize handle drag never changed its width", timeout: 5000 },
        )
        .toBeGreaterThan(8000);
    } finally {
      await deleteAllBeds(request);
    }
  });
});
