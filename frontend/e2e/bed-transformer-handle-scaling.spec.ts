import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #71 ("Verify/improve the bed-rotation
 * interaction in the canvas editor") - specifically the handle-scaling
 * half of it, per product-owner's own heads-up comment on this issue:
 * `BedNode.tsx`'s Transformer uses the *exact same* "divide anchorSize/
 * anchorStrokeWidth/borderStrokeWidth/rotateAnchorOffset by viewport.scale"
 * formula that #129 (GardenBoundary's identical fix) turned out to regress
 * in the opposite direction - handles ballooning huge when zoomed out
 * rather than shrinking to invisible dots. #129's own automated coverage
 * (`garden-boundary-handle-scaling.spec.ts`) only checked the handle was
 * *grabbable and functional*, which a ballooned handle still is - it
 * completely missed the real bug. This spec does what product-owner
 * explicitly asked for instead: directly *measures* the resize handle's
 * on-screen pixel size at two very different zoom levels and compares them,
 * rather than just confirming presence/grabbability.
 *
 * Measurement technique: Konva's Transformer anchors default to
 * `stroke: 'rgb(0, 161, 255)'` (confirmed directly in
 * `node_modules/konva/lib/shapes/Transformer.js` - this app never
 * overrides anchorStroke/anchorFill), which this codebase's bed fill
 * colors (`colorsForBedCategory`) and canvas background never otherwise
 * use. Composites every same-sized Konva `<canvas>` layer (same technique
 * `ruler-tick-visibility.spec.ts`/others in this directory use), scans a
 * horizontal strip through the expected handle center for that exact blue,
 * and reports the leftmost-to-rightmost matched-pixel span as the handle's
 * measured screen width - a big, robust signal regardless of the exact
 * true anchor size (correct ~10px, or a "balloon" of 50-150+px).
 *
 * Two independent scenarios (not just one page's before/after zoom) so
 * each can use a bed sized appropriately for its own resulting scale,
 * giving the scan window clean separation from every other handle/edge:
 * scenario A's small garden nearly matches the canvas (Fit view scale close
 * to 1 - "not zoomed out"), scenario B's huge garden forces Fit view down
 * to roughly 0.1-0.15 (the exact regime #129's bug report was about).
 *
 * Same Garden-row cleanup caveat as every other Garden-creating spec in
 * this directory (no `DELETE /api/garden` route exists).
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

function fitViewport(boxes: Box[], canvasSize: { width: number; height: number }, marginPx = 40) {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, canvasSize.width - marginPx * 2);
  const availableHeight = Math.max(1, canvasSize.height - marginPx * 2);
  const scale = Math.min(5, Math.max(0.1, Math.min(availableWidth / contentWidth, availableHeight / contentHeight)));
  const x = marginPx + (availableWidth - contentWidth * scale) / 2 - minX * scale;
  const y = marginPx + (availableHeight - contentHeight * scale) / 2 - minY * scale;
  return { x, y, scale };
}

function worldToScreen(point: Point, viewport: { x: number; y: number; scale: number }): Point {
  return { x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y };
}

async function putGarden(request: APIRequestContext, geometry: Rect): Promise<void> {
  const res = await request.put("/api/garden", { data: { name: "E2E Bed Handle Scaling Garden", border_geometry: geometry } });
  expect(res.ok(), `failed to PUT garden: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function deleteAllBeds(request: APIRequestContext): Promise<void> {
  const beds = await (await request.get("/api/beds")).json();
  for (const b of beds as { id: number }[]) {
    await request.delete(`/api/beds/${b.id}?cascade=true`).catch(() => {});
  }
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

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

const KONVA_ANCHOR_BLUE = { r: 0, g: 161, b: 255 };

/** Composites every same-sized Konva layer canvas (same rationale as
 * `ruler-tick-visibility.spec.ts`'s `regionContainsColor`), scans a
 * horizontal strip of CSS-px width `2*radiusPx+1` centered on
 * (centerCssX, centerCssY) for Konva's default anchor-stroke blue, and
 * returns the span (in CSS px) between the leftmost and rightmost matched
 * pixel - `null` if no match at all (handle invisible). A span pinned at
 * (or very near) `2*radiusPx` means the true handle extends *at least*
 * that far each direction - still a clear, comparable "very large" signal
 * even though it's a floor, not the exact true size. */
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
      let minMatchedDx: number | null = null;
      let maxMatchedDx: number | null = null;
      for (let dx = -radiusPx; dx <= radiusPx; dx++) {
        const localX = Math.round((centerCssX + dx - refBox.left) * scaleX);
        const localY = Math.round((centerCssY - refBox.top) * scaleY);
        if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) continue;
        const [r, g, b] = sctx.getImageData(localX, localY, 1, 1).data;
        if (Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance) {
          if (minMatchedDx === null) minMatchedDx = dx;
          maxMatchedDx = dx;
        }
      }
      if (minMatchedDx === null || maxMatchedDx === null) return null;
      return maxMatchedDx - minMatchedDx;
    },
    { centerCssX, centerCssY, radiusPx, target: KONVA_ANCHOR_BLUE },
  );
}

/** Sets up one garden+bed, fits the view, selects the bed, and returns the
 * measured screen-pixel width of its right-middle resize handle plus the
 * actual viewport scale that measurement happened at. */
async function measureAtScenario(
  page: Page,
  request: APIRequestContext,
  gardenBox: Box,
  bedBox: Box,
  radiusPx: number,
): Promise<{ widthPx: number | null; scale: number }> {
  await putGarden(request, { type: "rectangle", rotation: 0, ...gardenBox });
  await deleteAllBeds(request);
  await createBed(request, "E2E Handle Scaling Bed", rect(bedBox.x, bedBox.y, bedBox.width, bedBox.height));

  await page.goto("/layout"); // fresh navigation - fresh DEFAULT_VIEWPORT
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Beds" }).click();

  const box = await canvasBox(page);
  const canvasSize = { width: box.width, height: box.height };
  const expectedViewport = fitViewport([gardenBox], canvasSize, 40);

  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);

  const zoomText = await page.locator("text=/^\\d+%$/").first().textContent();
  const actualScalePercent = Number(zoomText?.replace("%", ""));
  expect(
    Math.abs(actualScalePercent / 100 - expectedViewport.scale),
    "replicated fitViewport formula didn't match the real toolbar zoom readout - can't trust computed handle position",
  ).toBeLessThan(0.05);

  // Select the bed - click its interior, well clear of any edge/handle.
  const bedCenterWorld = { x: bedBox.x + bedBox.width / 2, y: bedBox.y + bedBox.height / 2 };
  const bedCenterScreen = worldToScreen(bedCenterWorld, expectedViewport);
  await page.mouse.click(box.x + bedCenterScreen.x, box.y + bedCenterScreen.y);
  await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

  const handleWorld = { x: bedBox.x + bedBox.width, y: bedBox.y + bedBox.height / 2 };
  const handleScreen = worldToScreen(handleWorld, expectedViewport);
  const widthPx = await measureHandleWidthPx(page, box.x + handleScreen.x, box.y + handleScreen.y, radiusPx);

  return { widthPx, scale: expectedViewport.scale };
}

test.describe("Bed resize-handle screen size across zoom levels (#71)", () => {
  test("the resize handle's on-screen pixel size stays roughly constant, not ballooning or shrinking with zoom", async ({
    page,
    request,
  }) => {
    // Scenario A: garden nearly matches canvas size - Fit view lands close
    // to 100% (not zoomed out at all).
    const near1 = await measureAtScenario(
      page,
      request,
      { x: 0, y: 0, width: 800, height: 600 },
      { x: 40, y: 200, width: 700, height: 200 },
      70,
    );
    expect(near1.scale).toBeGreaterThan(0.5); // sanity: this really is the "not zoomed out" baseline

    // Scenario B: garden much larger than the canvas - Fit view forces a
    // heavily zoomed-out scale, the exact regime #129's bug report and
    // product-owner's follow-up comment were about.
    const zoomedOut = await measureAtScenario(
      page,
      request,
      { x: 0, y: 0, width: 8000, height: 6000 },
      { x: 500, y: 2500, width: 3000, height: 800 },
      120,
    );
    expect(zoomedOut.scale).toBeLessThan(0.3); // sanity: this really is "zoomed out"

    console.log(
      `[bed-transformer-handle-scaling] near-1x scale=${near1.scale.toFixed(3)} handle width=${near1.widthPx}px | ` +
        `zoomed-out scale=${zoomedOut.scale.toFixed(3)} handle width=${zoomedOut.widthPx}px`,
    );

    expect(near1.widthPx, "resize handle wasn't found (invisible/mispositioned) at the near-1x baseline").not.toBeNull();
    expect(zoomedOut.widthPx, "resize handle wasn't found (invisible/mispositioned) at the zoomed-out scale").not.toBeNull();

    const a = near1.widthPx as number;
    const b = zoomedOut.widthPx as number;
    // The whole point of dividing anchorSize/anchorStrokeWidth by
    // viewport.scale is a constant on-screen handle size regardless of
    // zoom - a generous 2.5x tolerance in either direction distinguishes
    // "working as intended" from a real ballooning/shrinking regression
    // (which product-owner's #129 report describes as handles growing to
    // "a huge size", not a marginal drift).
    expect(
      b / a,
      `resize handle width should stay roughly constant across zoom levels (measured ${a}px near 1x scale vs ` +
        `${b}px zoomed out) - a large ratio here is exactly the #129-style ballooning/shrinking regression`,
    ).toBeGreaterThan(1 / 2.5);
    expect(
      b / a,
      `resize handle width should stay roughly constant across zoom levels (measured ${a}px near 1x scale vs ` +
        `${b}px zoomed out) - a large ratio here is exactly the #129-style ballooning/shrinking regression`,
    ).toBeLessThan(2.5);
  });
});
