import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #66 ("Bed placement must stay within the
 * garden's boundary") - the ticket's own "How to test" section is a
 * drag/resize-near-the-edge interactive pass that a Vitest/jsdom unit test
 * can't drive (no real Konva pointer/drag system there). The underlying
 * clamp math (`clampPointToBounds`/`clampRectPositionToBounds`) already has
 * solid Vitest unit coverage in `geometry.test.ts` - what's untested is the
 * *integration*: does `BedNode.tsx` actually wire that math into a live
 * drag/resize gesture via `Layout.tsx`'s computed `gardenBounds`. This spec
 * asserts the ticket's actual invariant ("a bed's geometry may never extend
 * outside the garden's boundary") directly against the real post-gesture
 * geometry, rather than predicting the exact resulting numbers - the
 * clamp's specific strategy (cap width vs. reposition) isn't itself under
 * test, just that the end result never leaves the garden.
 *
 * IMPORTANT - unlike every other spec in this directory, this one has to
 * create a real `Garden` row (there's no `gardenBounds` without one) - and
 * there is no `DELETE /api/garden` route to clean it back up afterward
 * (`PUT /api/garden` is a singleton get-or-create; the API only ever
 * supports one). A stray `Garden` row left in `garden_test` would silently
 * change every *other* spec's behavior next time the full suite runs
 * together (they all deliberately avoid creating one - see e.g.
 * `bed-canvas-drag-pan.spec.ts`'s own doc on why). **After running this
 * file, manually clear the `garden` table in `garden_test`** (e.g. `DELETE
 * FROM garden;` via `.claude/skills/db-query`) before running the full
 * suite again - this is a real, sharp-edged gap in the API surface (no way
 * to programmatically tear down a Garden), not something this spec can work
 * around on its own from the outside.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Poly = { type: "polygon"; points: { x: number; y: number }[] };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function putGarden(request: APIRequestContext, geometry: Rect | Poly): Promise<{ id: number }> {
  const res = await request.put("/api/garden", { data: { name: "E2E Boundary Garden", border_geometry: geometry } });
  expect(res.ok(), `failed to PUT garden: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function deleteAutoCreatedGroundBed(request: APIRequestContext): Promise<void> {
  // The first PUT /api/garden auto-creates a "Ground" bed matching the
  // entire garden boundary (app/api/routes/garden.py) - it would overlap
  // every other bed and trip the "beds must not intersect" hard drag
  // constraint, so it's removed before this spec's own test beds go in.
  const beds = await (await request.get("/api/beds")).json();
  const ground = (beds as { id: number; name: string }[]).find((b) => b.name === "Ground");
  if (ground) await request.delete(`/api/beds/${ground.id}?cascade=true`).catch(() => {});
}

async function createBed(
  request: APIRequestContext,
  name: string,
  geometry: Rect | Poly,
): Promise<{ id: number; border_geometry: Rect | Poly }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function openBedsTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await page.getByRole("tab", { name: "Beds" }).click();
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

/** Polls `GET /api/beds/{id}` until its geometry differs from `original`
 * (JSON-string comparison, good enough for these plain-object geometries)
 * or a timeout is hit - a fixed `waitForTimeout` after `mouse.up()` here
 * was flaky (~1.5s needed, not the couple hundred ms every other spec in
 * this directory gets away with - this page's PATCH mutation apparently
 * takes noticeably longer to land than a plain click/select does), so this
 * polls instead of guessing a fixed delay. Returns the final fetched bed. */
async function waitForGeometryChange(
  request: APIRequestContext,
  bedId: number,
  original: unknown,
): Promise<{ border_geometry: Rect | Poly }> {
  const originalJson = JSON.stringify(original);
  let last: { border_geometry: Rect | Poly } | null = null;
  await expect
    .poll(
      async () => {
        last = await (await request.get(`/api/beds/${bedId}`)).json();
        return JSON.stringify(last!.border_geometry);
      },
      { message: `bed ${bedId}'s geometry never changed from its original value`, timeout: 5000 },
    )
    .not.toBe(originalJson);
  return last!;
}

test.describe("Bed placement clamped to the garden's boundary (#66)", () => {
  test("dragging a bed toward the garden edge stops it exactly at the boundary, never past it", async ({
    page,
    request,
  }) => {
    const garden = rect(0, 0, 500, 300);
    await putGarden(request, garden);
    await deleteAutoCreatedGroundBed(request);

    // Right edge at 450, 50cm of headroom before the garden's own right
    // edge (500) - the drag below tries to blow way past that.
    const bed = await createBed(request, "E2E Boundary Bed", rect(350, 100, 100, 100));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      const startX = box.x + 400; // bed center
      const startY = box.y + 150;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Drag 300cm right - would land the bed's right edge at 750, 250cm
      // past the garden's own right edge (500), if nothing clamped it.
      await page.mouse.move(startX + 300, startY, { steps: 15 });
      await page.mouse.up();

      const fetched = (await waitForGeometryChange(request, bed.id, bed.border_geometry)) as { border_geometry: Rect };
      const g = fetched.border_geometry;
      expect(g.x, "bed's left edge must not be pushed past the garden's own left edge").toBeGreaterThanOrEqual(garden.x);
      expect(g.x + g.width, "bed's right edge must never exceed the garden's right edge").toBeLessThanOrEqual(
        garden.x + garden.width,
      );
      // And it actually moved (proves this is a real clamp-during-drag, not
      // a drag that silently did nothing at all).
      expect(g.x).toBeGreaterThan(350);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("resizing a bed past the garden edge clamps the result to stay fully inside the boundary", async ({
    page,
    request,
  }) => {
    const garden = rect(0, 0, 500, 300);
    await putGarden(request, garden);
    await deleteAutoCreatedGroundBed(request);

    const bed = await createBed(request, "E2E Boundary Resize Bed", rect(350, 100, 100, 100));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      // Select it first so the Transformer's resize handles appear.
      await page.mouse.click(box.x + 400, box.y + 150);
      await page.waitForTimeout(150);

      // Grab the right-middle resize handle (world (450, 150), the bed's
      // right edge at mid-height) and drag it far past the garden's own
      // right edge.
      const handleX = box.x + 450;
      const handleY = box.y + 150;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 300, handleY, { steps: 15 });
      await page.mouse.up();

      const fetched = (await waitForGeometryChange(request, bed.id, bed.border_geometry)) as { border_geometry: Rect };
      const g = fetched.border_geometry;
      expect(g.x, "resized bed's left edge must not end up left of the garden").toBeGreaterThanOrEqual(garden.x);
      expect(g.x + g.width, "resized bed's right edge must never exceed the garden's right edge").toBeLessThanOrEqual(
        garden.x + garden.width,
      );
      // Something actually changed (the resize wasn't just silently
      // rejected outright) - either the width grew from 100, or (per the
      // clamp's reposition-not-just-cap strategy - see this file's own
      // top-of-file doc) the position shifted from x=350.
      expect(g.width !== 100 || g.x !== 350, "the resize gesture must have had *some* real effect").toBe(true);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("dragging a polygon bed toward a polygon garden's edge keeps every vertex within the garden's bounding box", async ({
    page,
    request,
  }) => {
    // A polygon garden boundary - bounding box is still (0,0)-(500,300),
    // same as the rectangle tests above, but exercised through the actual
    // polygon path (PolygonEditor.tsx's handleShapeDragEnd + BedNode.tsx's
    // handlePolygonChange), which clamps each vertex independently rather
    // than translating the whole shape - the "bounding-box approximation"
    // the ticket's own technical analysis flags as a known simplification,
    // not exact polygon-in-polygon containment.
    const gardenPolygon: Poly = {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 300 },
        { x: 0, y: 300 },
      ],
    };
    await putGarden(request, gardenPolygon);
    await deleteAutoCreatedGroundBed(request);

    const bedPolygon: Poly = {
      type: "polygon",
      points: [
        { x: 350, y: 100 },
        { x: 450, y: 100 },
        { x: 450, y: 200 },
        { x: 350, y: 200 },
      ],
    };
    const bed = await createBed(request, "E2E Boundary Polygon Bed", bedPolygon);

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      // Drag from inside the polygon bed's body (its center) far to the
      // right, same as the rectangle drag test.
      const startX = box.x + 400;
      const startY = box.y + 150;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 300, startY, { steps: 15 });
      await page.mouse.up();

      const fetched = (await waitForGeometryChange(request, bed.id, bed.border_geometry)) as { border_geometry: Poly };
      const points = fetched.border_geometry.points;
      expect(points.length).toBeGreaterThanOrEqual(3);
      for (const p of points) {
        expect(p.x, `vertex (${p.x},${p.y}) must not be left of the garden`).toBeGreaterThanOrEqual(0);
        expect(p.x, `vertex (${p.x},${p.y}) must not be right of the garden`).toBeLessThanOrEqual(500);
        expect(p.y, `vertex (${p.x},${p.y}) must not be above the garden`).toBeGreaterThanOrEqual(0);
        expect(p.y, `vertex (${p.x},${p.y}) must not be below the garden`).toBeLessThanOrEqual(300);
      }
      // The drag had *some* real effect - at least one vertex actually
      // moved from its original position.
      const original = bedPolygon.points;
      const moved = points.some((p, i) => p.x !== original[i].x || p.y !== original[i].y);
      expect(moved, "the polygon drag gesture must have had some real effect").toBe(true);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
