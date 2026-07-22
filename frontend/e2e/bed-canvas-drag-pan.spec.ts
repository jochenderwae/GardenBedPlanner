import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Regression coverage for backlog #14 ("dragging a bed or a polygon vertex
 * also pans the whole garden view"). The fix removed Stage-level
 * draggable/onDragStart/onDragEnd (which was cancelling the child node's own
 * in-progress drag - see the ticket's root-cause analysis) in favor of:
 *   - left-mouse-drag on a bed/vertex moves that item only
 *   - middle-mouse-drag anywhere pans the canvas, and only that
 *   - left-mouse-drag starting on empty canvas (Beds tab) marquee-selects
 *     beds instead of panning or moving anything
 *
 * These are exactly the interaction paths Konva's own hit-testing and drag
 * system make impossible to unit-test with jsdom (no real pointer/canvas
 * hit-graph there), hence a real headless-browser Playwright run against a
 * live dev server + real backend. Talks to whatever backend the dev server
 * currently proxies /api to - MUST be pointed at TEST_DATABASE_URL
 * (garden_test), never the real `garden` database (see root CLAUDE.md's
 * "Development environment" section). Each test seeds its own bed(s)
 * directly via the API (bypassing the "Add bed" UI/form, which isn't what's
 * under test here) and deletes them again afterward so the suite is
 * repeatable and doesn't leave garden_test dirty for anything else that
 * shares it (backend pytest, db-query).
 *
 * No Garden is created in any of these tests - Bed has no FK to Garden, and
 * `PUT /api/garden` auto-creates a ground-level Bed matching the *entire*
 * garden boundary (see app/api/routes/garden.py), which would overlap every
 * other bed and trip the "beds must not intersect" hard drag constraint
 * (BedNode.tsx's otherBedRects check) - out of scope for this ticket, and
 * avoided entirely by just not standing up a Garden.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: unknown): Promise<{ id: number }> {
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

/** Every PATCH `/api/beds/{id}` request observed on `page` since this was
 * called, keyed by bed id - lets a test assert both "this bed moved" and
 * "that other bed did NOT move" from the same recorded gesture. */
function trackBedPatches(page: Page): Map<number, unknown[]> {
  const byBedId = new Map<number, unknown[]>();
  page.on("requestfinished", async (req) => {
    if (req.method() !== "PATCH") return;
    const match = new URL(req.url()).pathname.match(/^\/api\/beds\/(\d+)$/);
    if (!match) return;
    const id = Number(match[1]);
    const body = req.postDataJSON();
    byBedId.set(id, [...(byBedId.get(id) ?? []), body]);
  });
  return byBedId;
}

test.describe("Bed canvas drag/pan/marquee-select (#14)", () => {
  let createdBedIds: number[] = [];

  test.beforeEach(() => {
    createdBedIds = [];
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdBedIds) {
      await request.delete(`/api/beds/${id}`).catch(() => {});
    }
  });

  test("left-mouse-drag on a bed moves that bed only, and does not pan the canvas", async ({ page, request }) => {
    const bedA = await createBed(request, "E2E Bed A", rect(40, 40, 150, 100));
    const bedB = await createBed(request, "E2E Bed B", rect(400, 300, 150, 100));
    createdBedIds.push(bedA.id, bedB.id);

    await openBedsTab(page);
    const box = await canvasBox(page);
    const patches = trackBedPatches(page);

    // Grab Bed A at its center (world (115, 90) for a (40,40,150,100) rect)
    // and drag it by a (150, 100) screen-px delta - both multiples of the
    // 10cm drag-snap grid so the expected landing spot is exact.
    const startX = box.x + 115;
    const startY = box.y + 90;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 100, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => patches.get(bedA.id)?.length ?? 0, { message: "expected a PATCH for Bed A" }).toBeGreaterThan(0);

    expect(patches.get(bedB.id), "Bed B must not move when only Bed A is dragged").toBeUndefined();

    const lastPatch = patches.get(bedA.id)!.at(-1) as { border_geometry: Rect };
    expect(lastPatch.border_geometry.x).toBe(190); // 40 + 150
    expect(lastPatch.border_geometry.y).toBe(140); // 40 + 100

    // Confirm it actually persisted server-side, not just an optimistic
    // client-side cache update that never reached the DB.
    const fetched = (await (await request.get(`/api/beds/${bedA.id}`)).json()) as { border_geometry: Rect };
    expect(fetched.border_geometry.x).toBe(190);
    expect(fetched.border_geometry.y).toBe(140);
  });

  // KNOWN REAL BUG (reported back on #14, not fixed here - see this repo's
  // tester agent's boundary: it verifies, it doesn't patch production code):
  // a middle-mouse-button drag that *starts on top of a bed* still nudges
  // that bed a little (observed x moving 40 -> 50, a single 10cm grid-snap
  // step) before the app's own `isPanning` pan logic takes over, because
  // Konva's `draggable` Rect responds to a mousedown of *any* button by
  // default - it isn't restricted to button 0 (left). `BedNode.tsx`'s Rect
  // has no button filter, so Konva's own drag-start races the app-level
  // `handlePanMouseDown` (which does correctly check `e.evt.button !== 1`).
  // 100% reproducible (confirmed across 3 repeat runs) when the gesture
  // starts directly over a bed; a middle-drag starting on empty canvas is
  // unaffected. Left failing (not skipped) so it stays visible until a
  // frontend-developer pass adds a button filter to BedNode's (and
  // PolygonEditor's, likely the same root cause) draggable nodes.
  test("middle-mouse-drag pans the canvas without moving or selecting any bed", async ({ page, request }) => {
    const bedA = await createBed(request, "E2E Bed A", rect(40, 40, 150, 100));
    createdBedIds.push(bedA.id);

    await openBedsTab(page);
    const box = await canvasBox(page);
    const patches = trackBedPatches(page);

    // Start the middle-drag directly on top of Bed A - proves pan wins even
    // when the gesture starts over a draggable shape, not just over empty
    // canvas.
    const startX = box.x + 115;
    const startY = box.y + 90;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(startX + 60, startY + 40, { steps: 10 });
    await page.mouse.up({ button: "middle" });

    // Give any (incorrect) PATCH a moment to have fired before asserting its
    // absence.
    await page.waitForTimeout(300);
    expect(patches.get(bedA.id), "a middle-drag must never PATCH a bed's geometry").toBeUndefined();

    // No BedPanel should have opened from the middle-click either.
    await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);

    // Positive proof the pan actually moved the view: a plain click at Bed
    // A's *panned* screen position (original center + the same 60,40 pan
    // delta) should now hit it and open its panel.
    await page.mouse.click(startX + 60, startY + 40);
    await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
    await expect(page.getByRole("textbox").first()).toHaveValue("E2E Bed A");

    // And its geometry was never touched by any of this.
    const fetched = (await (await request.get(`/api/beds/${bedA.id}`)).json()) as { border_geometry: Rect };
    expect(fetched.border_geometry.x).toBe(40);
    expect(fetched.border_geometry.y).toBe(40);
  });

  test("left-mouse-drag starting on empty canvas marquee-selects a single overlapped bed, without moving it", async ({
    page,
    request,
  }) => {
    const bedA = await createBed(request, "E2E Bed A", rect(40, 40, 150, 100));
    const bedB = await createBed(request, "E2E Bed B", rect(400, 300, 150, 100));
    createdBedIds.push(bedA.id, bedB.id);

    await openBedsTab(page);
    const box = await canvasBox(page);
    const patches = trackBedPatches(page);

    // Marquee from (10,10) to (200,160) world - fully encloses Bed A
    // (40,40)-(190,140) without touching Bed B (400,300)-(550,400).
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 160, { steps: 10 });
    await page.mouse.up();

    expect(patches.get(bedA.id), "a marquee-select must never move a bed").toBeUndefined();
    expect(patches.get(bedB.id)).toBeUndefined();

    // A single hit opens the ordinary single-bed panel.
    await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
    await expect(page.getByRole("textbox").first()).toHaveValue("E2E Bed A");
  });

  test("left-mouse-drag starting on empty canvas over multiple beds selects them without opening the single-bed panel or moving anything", async ({
    page,
    request,
  }) => {
    const bedA = await createBed(request, "E2E Bed A", rect(40, 40, 150, 100));
    const bedB = await createBed(request, "E2E Bed B", rect(400, 300, 150, 100));
    createdBedIds.push(bedA.id, bedB.id);

    await openBedsTab(page);
    const box = await canvasBox(page);
    const patches = trackBedPatches(page);

    // Marquee from (10,10) to (600,450) world - encloses both beds.
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 600, box.y + 450, { steps: 10 });
    await page.mouse.up();

    expect(patches.get(bedA.id)).toBeUndefined();
    expect(patches.get(bedB.id)).toBeUndefined();

    // No single-bed-edit panel for a 2+ hit (see Layout.tsx's own doc on
    // selectedBedIds - there's no bulk-bed-edit panel yet).
    await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);

    const [freshA, freshB] = await Promise.all([
      (await request.get(`/api/beds/${bedA.id}`)).json() as Promise<{ border_geometry: Rect }>,
      (await request.get(`/api/beds/${bedB.id}`)).json() as Promise<{ border_geometry: Rect }>,
    ]);
    expect(freshA.border_geometry.x).toBe(40);
    expect(freshB.border_geometry.x).toBe(400);
  });

  test("dragging a polygon bed's vertex moves that vertex only, without panning the canvas", async ({ page, request }) => {
    const bedC = await createBed(request, "E2E Bed C", {
      type: "polygon",
      points: [
        { x: 700, y: 40 },
        { x: 850, y: 40 },
        { x: 850, y: 140 },
        { x: 700, y: 140 },
      ],
    });
    createdBedIds.push(bedC.id);

    await openBedsTab(page);
    const box = await canvasBox(page);
    const patches = trackBedPatches(page);

    // Select it first - vertex handles only render once selected
    // (PolygonEditor.tsx's `showHandles = interactive && isSelected`).
    await page.mouse.click(box.x + 775, box.y + 90);
    await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

    // Drag the first vertex (700,40) by (50,30) - both multiples of the
    // 10cm snap grid.
    const vx = box.x + 700;
    const vy = box.y + 40;
    await page.mouse.move(vx, vy);
    await page.mouse.down();
    await page.mouse.move(vx + 50, vy + 30, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => patches.get(bedC.id)?.length ?? 0, { message: "expected a PATCH for Bed C" }).toBeGreaterThan(0);

    const lastPatch = patches.get(bedC.id)!.at(-1) as {
      border_geometry: { type: "polygon"; points: { x: number; y: number }[] };
    };
    const points = lastPatch.border_geometry.points;
    expect(points[0]).toEqual({ x: 750, y: 70 }); // 700+50, 40+30
    // The other three vertices are untouched by a single-vertex drag.
    expect(points[1]).toEqual({ x: 850, y: 40 });
    expect(points[2]).toEqual({ x: 850, y: 140 });
    expect(points[3]).toEqual({ x: 700, y: 140 });
  });
});
