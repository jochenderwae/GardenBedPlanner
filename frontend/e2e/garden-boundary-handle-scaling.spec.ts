import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #129 ("Fix GardenBoundary rotate/resize
 * handles shrinking to invisible dots when zoomed out") - mirrors #71's
 * identical fix for `BedNode.tsx`. The implementer's own outcome comment
 * explicitly leaves the interactive zoom/drag verification for the tester
 * role.
 *
 * Targets the *resize* handle (not the rotate handle): its screen position
 * is unambiguous - exactly at the rect's own edge midpoint, no extra
 * offset to reverse-engineer - while both anchor types are governed by the
 * exact same `anchorSize`/`anchorStrokeWidth` fix this ticket is actually
 * about. A debug screenshot taken while building this spec confirmed the
 * rotate handle is also present and reasonably sized at this same zoom
 * level (not an invisible dot), but its exact on-screen position relative
 * to the shape didn't match the naive "directly above top-center" formula
 * `compass-widget.spec.ts` used successfully for a *symmetric* proxy
 * circle - Konva's default single-rectangle Transformer appears to
 * position it differently, and chasing the exact formula further wasn't
 * worth the time against a resize-handle test that already exercises the
 * identical size-fix code path precisely.
 *
 * Same Garden-row cleanup caveat as every other Garden-creating spec in
 * this directory (no `DELETE /api/garden` route exists) - clear
 * `garden_test`'s `garden` table manually after running this file.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

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

async function putGarden(request: APIRequestContext, geometry: Rect): Promise<{ id: number }> {
  const res = await request.put("/api/garden", { data: { name: "E2E Boundary Handle Garden", border_geometry: geometry } });
  expect(res.ok(), `failed to PUT garden: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function deleteAutoCreatedGroundBed(request: APIRequestContext): Promise<void> {
  const beds = await (await request.get("/api/beds")).json();
  const ground = (beds as { id: number; name: string }[]).find((b) => b.name === "Ground");
  if (ground) await request.delete(`/api/beds/${ground.id}?cascade=true`).catch(() => {});
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

test.describe("Garden boundary rotate/resize handles at extreme zoom (#129)", () => {
  test("the resize handle is genuinely grabbable and functional at a zoomed-out scale", async ({ page, request }) => {
    const gardenRect: Box = { x: 0, y: 0, width: 3000, height: 2000 };
    await putGarden(request, { type: "rectangle", rotation: 0, ...gardenRect });
    await deleteAutoCreatedGroundBed(request);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
      if (await startFromScratch.isVisible().catch(() => false)) await startFromScratch.click();
      await page.getByRole("tab", { name: "Garden" }).click();

      const box = await canvasBox(page);
      const canvasSize = { width: box.width, height: box.height };
      const expectedViewport = fitViewport([gardenRect], canvasSize, 40);

      await page.getByRole("button", { name: "Fit view" }).click();
      await page.waitForTimeout(200);

      const zoomText = await page.locator("text=/^\\d+%$/").first().textContent();
      const actualScalePercent = Number(zoomText?.replace("%", ""));
      expect(Math.abs(actualScalePercent / 100 - expectedViewport.scale)).toBeLessThan(0.05);
      // Confirm this scenario is actually "zoomed out" - the whole point of
      // the bug being tested (at scale=1, even the old, unfixed anchor
      // size would have been a reasonable ~10px - the bug only shows up
      // well below that).
      expect(expectedViewport.scale).toBeLessThan(0.5);

      // No click-to-select needed: GardenBoundary.tsx's own `isSelected`
      // prop is wired directly to `tab === "garden"` (Layout.tsx), not a
      // separate click-driven selection state the way beds have - the
      // Transformer is already attached the moment the Garden tab is
      // active. (Confirmed the hard way: an earlier version of this spec
      // clicked the boundary's edge to "select" it first, which actually
      // nudged the shape a real few cm via an incidental micro-drag on the
      // always-draggable Rect.)

      // Right-middle resize handle: exactly at the rect's own right-edge
      // midpoint, world (3000, 1000).
      const handleWorld = { x: gardenRect.width, y: gardenRect.height / 2 };
      const handleScreen = worldToScreen(handleWorld, expectedViewport);
      const handlePageX = box.x + handleScreen.x;
      const handlePageY = box.y + handleScreen.y;

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
        .toBeGreaterThan(gardenRect.width);
    } finally {
      await deleteAutoCreatedGroundBed(request);
    }
  });
});
