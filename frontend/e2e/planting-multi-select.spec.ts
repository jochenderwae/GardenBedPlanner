import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #19 ("Multi-select (marquee + shift-click) for
 * plantings, with bulk delete/move") - all 6 of the ticket's own "How to
 * test" steps drive real drag/click/keyboard gestures on the Konva canvas,
 * which neither a typecheck nor a Vitest/jsdom test can exercise. The pure
 * `normalizedRect`/`translateGeometry` helpers behind marquee-selection and
 * bulk-move already have solid Vitest coverage - what's untested is
 * whether `Layout.tsx`/`PlantPlacementLayer.tsx` actually wire a real
 * marquee drag, shift-click, and grouped drag through to them.
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

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  geometry: Rect,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry, planted_date: null, removed_date: null },
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

async function plantingGeometry(request: APIRequestContext, id: number): Promise<Rect> {
  return (await (await request.get(`/api/plantings/${id}`)).json()).geometry;
}

type RGBA = { r: number; g: number; b: number; a: number };

/** Composites every same-sized Konva layer canvas and samples a small grid
 * of points across a CSS-pixel region, returning each point's RGBA - same
 * technique `live-dimension-labels.spec.ts` (#15) uses to catch a purely
 * mid-gesture-only visual that neither a typecheck nor a Vitest/jsdom test
 * can observe, and the exact right tool for this ticket's own two
 * regressions (marquee rectangle not actually rendering during the drag;
 * only the dragged marker moving live, the rest snapping at drop) - both
 * are mid-gesture-only symptoms an end-state-only assertion (as the rest of
 * this file's own first test uses) structurally cannot catch, which is
 * exactly how the original regression shipped unnoticed. */
async function sampleRegion(page: Page, cssX: number, cssY: number, width: number, height: number, stepPx = 3): Promise<RGBA[]> {
  return page.evaluate(
    ({ cssX, cssY, width, height, stepPx }) => {
      const all = Array.from(document.querySelectorAll("canvas"));
      const reference = all[0];
      if (!reference) return [];
      const refBox = reference.getBoundingClientRect();
      const layers = all.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left === refBox.left && b.top === refBox.top && b.width === refBox.width && b.height === refBox.height;
      });
      if (layers.length === 0) return [];
      const scratch = document.createElement("canvas");
      scratch.width = reference.width;
      scratch.height = reference.height;
      const sctx = scratch.getContext("2d");
      if (!sctx) return [];
      for (const layer of layers) sctx.drawImage(layer, 0, 0);
      const scaleX = reference.width / refBox.width;
      const scaleY = reference.height / refBox.height;
      const points: RGBA[] = [];
      for (let dy = 0; dy < height; dy += stepPx) {
        for (let dx = 0; dx < width; dx += stepPx) {
          const localX = Math.round((cssX + dx - refBox.left) * scaleX);
          const localY = Math.round((cssY + dy - refBox.top) * scaleY);
          if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) continue;
          const [r, g, b, a] = sctx.getImageData(localX, localY, 1, 1).data;
          points.push({ r, g, b, a });
        }
      }
      return points;
    },
    { cssX, cssY, width, height, stepPx },
  );
}

function regionsDiffer(a: RGBA[], b: RGBA[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((pa, i) => {
    const pb = b[i];
    return Math.abs(pa.r - pb.r) > 10 || Math.abs(pa.g - pb.g) > 10 || Math.abs(pa.b - pb.b) > 10 || Math.abs(pa.a - pb.a) > 10;
  });
}

test.describe("Planting multi-select: marquee, shift-click, bulk move/delete (#19)", () => {
  test("marquee-select, shift-click add/remove, bulk move (+undo), and bulk delete all work together", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Multiselect Bed", rect(200, 200, 400, 400));
    const slug = `e2e-multiselect-plant-${Date.now()}`;
    await request.post("/api/plants", { data: { slug, common_name: "E2E Multiselect Plant", botanical_name: "Testus e2eus" } });

    // Bed-local positions, well separated: A(40,40) B(140,40) C(240,40),
    // each 40x40.
    const plantingA = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40));
    const plantingB = await createPlanting(request, bed.id, slug, rect(140, 40, 40, 40));
    const plantingC = await createPlanting(request, bed.id, slug, rect(240, 40, 40, 40));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      // World centers: A(260,260) B(360,260) C(460,260) (bed at 200,200).
      const centerA = { x: box.x + 260, y: box.y + 260 };
      const centerB = { x: box.x + 360, y: box.y + 260 };
      const centerC = { x: box.x + 460, y: box.y + 260 };

      // --- Step 1: marquee over A and B only (not C) ---
      await page.mouse.move(box.x + 220, box.y + 220); // world (220,220), empty space above/left of A
      await page.mouse.down();
      await page.mouse.move(box.x + 400, box.y + 300, { steps: 10 }); // world (400,300) - covers A+B, not C
      await page.mouse.up();

      const bulkPanel = page.getByRole("heading", { name: /plantings selected/ });
      await expect(bulkPanel).toHaveText("2 plantings selected");

      // Neither moved from the marquee itself.
      expect(await plantingGeometry(request, plantingA.id)).toEqual(rect(40, 40, 40, 40));
      expect(await plantingGeometry(request, plantingB.id)).toEqual(rect(140, 40, 40, 40));

      // --- Step 2: shift-click C to add it; shift-click B to remove it ---
      // `page.mouse.click` (the low-level Mouse API) has no `modifiers`
      // option - that's only on `Locator`/`ElementHandle.click()` - so a
      // real shift-click here needs an explicit keyboard down/up around
      // the click instead.
      await page.keyboard.down("Shift");
      await page.mouse.click(centerC.x, centerC.y);
      await page.keyboard.up("Shift");
      await expect(bulkPanel).toHaveText("3 plantings selected");

      await page.keyboard.down("Shift");
      await page.mouse.click(centerB.x, centerB.y);
      await page.keyboard.up("Shift");
      await expect(bulkPanel).toHaveText("2 plantings selected"); // now A + C

      // --- Step 3: dragging A (part of the A+C selection) moves both by
      // the same offset, B (no longer selected) stays put ---
      await page.mouse.move(centerA.x, centerA.y);
      await page.mouse.down();
      await page.mouse.move(centerA.x + 50, centerA.y + 30, { steps: 10 }); // +50,+30
      await page.mouse.up();

      await expect
        .poll(async () => plantingGeometry(request, plantingA.id), { message: "planting A never moved" })
        .toEqual(rect(90, 70, 40, 40));
      await expect
        .poll(async () => plantingGeometry(request, plantingC.id), { message: "planting C (grouped with A) never moved" })
        .toEqual(rect(290, 70, 40, 40));
      expect(await plantingGeometry(request, plantingB.id), "unselected planting B must not have moved").toEqual(
        rect(140, 40, 40, 40),
      );

      // --- Step 4: Ctrl+Z reverts the whole group as one step ---
      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => plantingGeometry(request, plantingA.id), { message: "Ctrl+Z never reverted planting A" })
        .toEqual(rect(40, 40, 40, 40));
      expect(await plantingGeometry(request, plantingC.id), "Ctrl+Z must revert C in the same step as A").toEqual(
        rect(240, 40, 40, 40),
      );

      // --- Step 5: bulk delete removes every selected planting ---
      // The undo above didn't change the selection itself - A+C are still
      // the active multi-selection.
      await expect(bulkPanel).toHaveText("2 plantings selected");
      await page.getByRole("button", { name: /Remove 2 plantings/ }).click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole("button", { name: /Remove 2 plantings/ }).click();

      await expect.poll(async () => (await request.get(`/api/plantings/${plantingA.id}`)).status()).toBe(404);
      expect((await request.get(`/api/plantings/${plantingC.id}`)).status()).toBe(404);
      // B was never part of the selection - untouched.
      expect((await request.get(`/api/plantings/${plantingB.id}`)).status()).toBe(200);
    } finally {
      for (const p of [plantingA, plantingB, plantingC]) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a plain click with no active multi-selection opens the normal single-planting edit panel", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Single Click Bed", rect(200, 200, 200, 200));
    const slug = `e2e-single-click-plant-${Date.now()}`;
    const commonName = "E2E Single Click Plant";
    await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
    const planting = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 260, box.y + 260); // plain click, no shift

      await expect(page.getByRole("heading", { name: commonName })).toBeVisible();
      await expect(page.getByRole("heading", { name: /plantings selected/ })).toHaveCount(0);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  // Regression coverage for the user's own follow-up report: the marquee
  // rectangle previously stopped rendering/tracking the instant a drag
  // crossed outside the bed it started in (root cause: PlantPlacementLayer's
  // draw/marquee tracking was driven by mousemove/mouseup handlers attached
  // to each *bed's own background Rect*, which Konva only fires while the
  // pointer stays over that shape). Fixed by moving that tracking to
  // Stage-level handlers (same pattern Layout.tsx's own bed marquee already
  // used). This is a mid-gesture-only visual an end-state-only assertion
  // (like this file's first test) structurally cannot catch - see
  // `sampleRegion`/`regionsDiffer`'s own doc for why a real pixel sample is
  // used instead.
  test("the marquee rectangle stays visible and keeps tracking the cursor even after it crosses outside the bed it started in", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Marquee Cross-Edge Bed", rect(200, 200, 150, 150));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      // A region well outside the bed (bed spans world x:200-350, y:200-350)
      // but still safely within the canvas's own rendered bounds - an
      // earlier version of this test picked a target point that (on this
      // canvas's actual ~1251x481 size) fell just past the canvas's own
      // bottom edge, sampling blank page background rather than anything
      // Konva ever draws to regardless of whether the marquee tracked
      // correctly - a false failure from the test's own setup, not a real
      // regression (confirmed via a throwaway screenshot showing the
      // marquee rectangle correctly growing to fill the visible canvas).
      const outsideRegion = { x: box.x + 700, y: box.y + 400 };

      const before = await sampleRegion(page, outsideRegion.x - 15, outsideRegion.y - 15, 30, 30);

      await page.mouse.move(box.x + 250, box.y + 250); // inside the bed, empty space
      await page.mouse.down();
      await page.mouse.move(box.x + 400, box.y + 350, { steps: 6 }); // still roughly mid-drag
      await page.mouse.move(outsideRegion.x, outsideRegion.y, { steps: 6 }); // now crossed well outside the bed

      const midGesture = await sampleRegion(page, outsideRegion.x - 15, outsideRegion.y - 15, 30, 30);
      await page.mouse.up();

      expect(
        regionsDiffer(before, midGesture),
        "no visible marquee rectangle reached this region after the drag crossed outside the bed it started in - " +
          "either the rectangle stopped tracking, or never rendered at all",
      ).toBe(true);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  // Regression coverage for the user's second follow-up report: dragging
  // one of several selected markers used to only move that one marker
  // live, with the rest of the group snapping into place only once the
  // gesture was released - confirmed fixed by imperatively repositioning
  // every other selected marker's own Konva node on each onDragMove tick
  // (PlantPlacementLayer.tsx's nodeRefs/dragGroupRef), independent of the
  // real geometry commit that still only happens on drag-end (this file's
  // first test already covers that end-state). Same mid-gesture-only
  // rationale as the marquee test above - checks a *different* marker's
  // own position mid-drag, not the dragged one.
  test("dragging one selected marker visibly moves every other selected marker in real time, not just at release", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Live Group Drag Bed", rect(200, 200, 400, 400));
    const slug = `e2e-live-group-drag-plant-${Date.now()}`;
    await request.post("/api/plants", { data: { slug, common_name: "E2E Live Group Drag Plant", botanical_name: "Testus e2eus" } });

    // A(40,40) and B(240,40), both 40x40, well separated so B's own region
    // isn't touched by A's drag path or vice versa.
    const plantingA = await createPlanting(request, bed.id, slug, rect(40, 40, 40, 40));
    const plantingB = await createPlanting(request, bed.id, slug, rect(240, 40, 40, 40));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      // World centers: A(260,260), B(460,260) (bed at 200,200).
      const centerA = { x: box.x + 260, y: box.y + 260 };
      const centerB = { x: box.x + 460, y: box.y + 260 };
      // Where B should visually land mid-drag if it's following A live -
      // same +150,+100 delta A itself is about to be dragged by.
      const bExpectedLive = { x: centerB.x + 150, y: centerB.y + 100 };

      // Select both via marquee.
      await page.mouse.move(box.x + 220, box.y + 220);
      await page.mouse.down();
      await page.mouse.move(box.x + 500, box.y + 300, { steps: 10 });
      await page.mouse.up();
      await expect(page.getByRole("heading", { name: /plantings selected/ })).toHaveText("2 plantings selected");

      const bOriginalRegionBefore = await sampleRegion(page, centerB.x - 15, centerB.y - 15, 30, 30);
      const bLiveRegionBefore = await sampleRegion(page, bExpectedLive.x - 15, bExpectedLive.y - 15, 30, 30);

      // Drag A - B should visibly follow mid-gesture (well before mouseup).
      await page.mouse.move(centerA.x, centerA.y);
      await page.mouse.down();
      await page.mouse.move(centerA.x + 150, centerA.y + 100, { steps: 10 });

      const bOriginalRegionMidDrag = await sampleRegion(page, centerB.x - 15, centerB.y - 15, 30, 30);
      const bLiveRegionMidDrag = await sampleRegion(page, bExpectedLive.x - 15, bExpectedLive.y - 15, 30, 30);
      await page.mouse.up();

      expect(
        regionsDiffer(bOriginalRegionBefore, bOriginalRegionMidDrag),
        "planting B's original position still looks unchanged mid-drag - it isn't visibly following A live, only at release",
      ).toBe(true);
      expect(
        regionsDiffer(bLiveRegionBefore, bLiveRegionMidDrag),
        "no visible content appeared at B's expected live (mid-drag) position - B isn't following A's drag delta in real time",
      ).toBe(true);

      // And the real, committed end state is still correct (this file's
      // first test already covers this shape in more depth - just a
      // sanity confirmation this specific gesture also lands correctly).
      await expect
        .poll(async () => plantingGeometry(request, plantingB.id), { message: "planting B never committed its real geometry update" })
        .toEqual(rect(390, 140, 40, 40));
    } finally {
      for (const p of [plantingA, plantingB]) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
