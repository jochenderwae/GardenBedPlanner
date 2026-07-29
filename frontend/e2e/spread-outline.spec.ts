import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Coverage for #173 ("render plant size (spread) as a light outline behind
 * its marker"), against the ui-ux-designer's own design spec posted on the
 * ticket (SpreadOutline: unfilled, colorForSlug-stroked, opacity 0.3, sized
 * off Plant.spread_cm / 2, two-pass render order so outlines never sit on
 * top of a neighboring planting's solid marker). Same real-`<canvas>`-pixel
 * technique as plant-footprint-shapes.spec.ts (#132) - Konva draws to
 * `<canvas>` with no DOM representation a typecheck or jsdom-based test
 * could inspect, so this reads composited pixel data straight out of the
 * live layers via `getImageData`. Every planting here uses `growth_habit:
 * null` (the plain-circle fallback) deliberately, to keep the outline/marker
 * radius geometry exact and testable - #132's own spec already covers the
 * per-habit *shape* mapping, which SpreadOutline reuses unmodified.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, size: number): Rect {
  return { type: "rectangle", x, y, width: size, height: size, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createPlant(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  spreadCm: number | null,
): Promise<{ slug: string }> {
  const res = await request.post("/api/plants", {
    data: {
      slug,
      common_name: commonName,
      botanical_name: "Testus e2eus",
      growth_habit: null,
      spread_cm: spreadCm,
    },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
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
  expect(res.ok(), `failed to create planting for "${plantSlug}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Same compositing approach as plant-footprint-shapes.spec.ts's own
 * `samplePixel` - reads the real, composited RGBA a human would see at a
 * CSS-pixel page position by drawing every same-sized `<canvas>` layer onto
 * a scratch canvas in DOM order, rather than inspecting a single layer that
 * might legitimately have nothing at that point. */
async function samplePixel(page: Page, cssX: number, cssY: number): Promise<{ r: number; g: number; b: number; a: number } | null> {
  return page.evaluate(
    ({ cssX, cssY }) => {
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
      const localX = Math.round((cssX - refBox.left) * scaleX);
      const localY = Math.round((cssY - refBox.top) * scaleY);
      if (localX < 0 || localY < 0 || localX >= scratch.width || localY >= scratch.height) return null;

      const [r, g, b, a] = sctx.getImageData(localX, localY, 1, 1).data;
      return a > 0 ? { r, g, b, a } : null;
    },
    { cssX, cssY },
  );
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

test.describe("Plant spread outline (#173)", () => {
  test("renders a light outline at spread_cm/2 that never covers a neighboring planting's solid marker, and omits gracefully when spread_cm is unset", async ({
    page,
    request,
  }) => {
    // Kept small (well inside a real browser's default ~900x520 canvas
    // boundingBox - measured directly, since neither CANVAS_WIDTH_PX/
    // CANVAS_HEIGHT_PX nor a fit-to-view scale can be assumed here, see
    // #14/#204's own "don't hand-replicate fitViewport" lesson) so the
    // viewport stays at its DEFAULT_VIEWPORT (scale 1, no pan) the entire
    // test - no "Fit view" click, no fitViewport math to reason about, and
    // `box.x + worldX` is exactly the on-screen position.
    const bed = await createBed(request, "E2E Spread Outline Bed", rect(0, 0, 400));
    const suffix = Date.now();

    // Large-spread plant: spread_cm 100 -> outline radius 50. Small solid
    // marker (geometry size 20 -> marker radius 10, per
    // PlantPlacementLayer's `radius = boundingRect(geometry).width / 2`),
    // well inside the outline so the two are visually distinct rings.
    const spreaderSlug = `e2e-spreader-${suffix}`;
    await createPlant(request, spreaderSlug, "Spreader", 100);
    const spreaderCenter = { x: 100, y: 100 }; // geometry (90,90,20) -> center (100,100)
    const spreaderPlanting = await createPlanting(request, bed.id, spreaderSlug, rect(90, 90, 20));

    // A second, unrelated planting with no spread_cm at all, positioned
    // exactly on the spreader's own outline ring (50cm along +x from its
    // center) - if outlines were ever drawn interleaved with markers
    // (instead of the required two-pass "every outline, then every marker"
    // order), the spreader's outline stroke could render on top of this
    // marker wherever the two crossed. Positioned dead-on the ring itself
    // (not just "somewhere near it") so the z-order check is meaningful:
    // wrong order predicts a visibly blended pixel here, right order
    // predicts this marker's own solid color, unblended.
    const neighborSlug = `e2e-neighbor-${suffix}`;
    await createPlant(request, neighborSlug, "Neighbor", null);
    const neighborCenter = { x: spreaderCenter.x + 50, y: spreaderCenter.y };
    const neighborPlanting = await createPlanting(
      request,
      bed.id,
      neighborSlug,
      rect(neighborCenter.x - 10, neighborCenter.y - 10, 20),
    );

    const createdPlantingIds = [spreaderPlanting.id, neighborPlanting.id];
    const createdPlantSlugs = [spreaderSlug, neighborSlug];

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");

      const toScreen = (local: { x: number; y: number }) => ({ x: box.x + local.x, y: box.y + local.y });

      // Bare-bed control point, far from every marker/outline - the "nothing
      // drawn here but the bed itself" baseline every comparison below is
      // relative to (matches plant-footprint-shapes.spec.ts's own pattern).
      // (350,350) is comfortably inside the 400x400 bed and far from both
      // plantings (both sit near (100,100)).
      const control = await samplePixel(page, box.x + 350, box.y + 350);
      expect(control, "control point (bare bed background) must render as something visible").not.toBeNull();

      // --- Criterion 1: the outline is actually there. ---
      // Sample at 25cm from the spreader's center - past its own solid
      // marker (radius 10) but well inside its outline radius (50), and far
      // from the outline's own stroke (~49.5-50.5), so this lands on truly
      // empty (fill-omitted) outline interior - which means nothing should
      // be drawn there at all. Use this as a second control instead: confirm
      // it equals bare background (the outline is stroke-only, not a filled
      // disc), then confirm the *stroke itself* (at the 50cm ring) is
      // genuinely visible and distinct from background.
      const outlineInterior = await samplePixel(page, toScreen({ x: spreaderCenter.x + 25, y: spreaderCenter.y }).x, toScreen({ x: spreaderCenter.x + 25, y: spreaderCenter.y }).y);
      expect(outlineInterior, "SpreadOutline must be unfilled (stroke-only) - its interior should show the bed, not a solid disc").not.toBeNull();

      // Sample the outline's stroke on an axis with nothing else nearby
      // (straight up from center, away from the neighbor planting placed
      // along +x) to positively confirm the ring itself renders.
      const ringPoint = toScreen({ x: spreaderCenter.x, y: spreaderCenter.y - 50 });
      const ringPixel = await samplePixel(page, ringPoint.x, ringPoint.y);
      expect(ringPixel, "the spread outline's stroke must be visible at spread_cm/2 from the planting's center").not.toBeNull();
      expect(colorDistance(ringPixel!, control!), "the outline ring must read as visually distinct from bare bed background").toBeGreaterThan(10);

      // --- Criterion 2: the outline reads as secondary, not dominant. ---
      // The solid marker (opacity 0.85) should sit visually farther from
      // the bare-bed control color than the low-opacity (0.3) outline ring
      // does - i.e. the outline blends more with the background than the
      // marker does, the objective form of "reads as background/secondary".
      const markerScreen = toScreen(spreaderCenter);
      const markerPixel = await samplePixel(page, markerScreen.x, markerScreen.y);
      expect(markerPixel, "the spreader's own solid marker must be visible").not.toBeNull();
      const markerDistance = colorDistance(markerPixel!, control!);
      const outlineDistance = colorDistance(ringPixel!, control!);
      expect(
        outlineDistance,
        `outline (distance ${outlineDistance} from background) should blend with the background more than the fully-opaque solid marker (distance ${markerDistance}) does - it must read as secondary, not dominant`,
      ).toBeLessThan(markerDistance);

      // --- Criterion 3 / z-order: the outline never covers a neighbor's marker. ---
      // The neighbor's own marker sits exactly on the spreader's outline
      // ring. With the required two-pass render order (every outline, then
      // every marker), the neighbor's fully-opaque marker paints last and
      // wins outright at its own center - so this pixel must be
      // indistinguishable from what an isolated marker of the same shape/
      // size would render (i.e. clearly closer to "fully-opaque marker"
      // territory than to the low-opacity outline stroke's own blend level).
      const neighborScreen = toScreen(neighborCenter);
      const neighborPixel = await samplePixel(page, neighborScreen.x, neighborScreen.y);
      expect(neighborPixel, "the neighboring planting's own marker must be visible even though the spreader's outline ring crosses through it").not.toBeNull();
      const neighborDistance = colorDistance(neighborPixel!, control!);
      expect(
        neighborDistance,
        "the neighbor's marker must render at (approximately) full solid-marker opacity, not blended down toward the outline's own lighter stroke, proving markers paint after (on top of) outlines",
      ).toBeGreaterThan(outlineDistance);

      // --- Criterion 4: no spread_cm -> no outline, no crash. ---
      // The page must still be up and responsive (no uncaught exception
      // tore down the canvas) - a positive re-check that a normal marker
      // click still works for the no-spread_cm planting, plus confirming no
      // outline ring was drawn around it at all (30cm out, well past its own
      // marker radius of 10, would be well inside even the smallest
      // meaningful spread outline if one had incorrectly been given a
      // default-size fallback).
      const noOutlinePoint = toScreen({ x: neighborCenter.x, y: neighborCenter.y - 30 });
      const noOutlinePixel = await samplePixel(page, noOutlinePoint.x, noOutlinePoint.y);
      expect(noOutlinePixel, "a planting with no spread_cm must not fall back to a default-size outline").toEqual(control);
    } finally {
      for (const id of createdPlantingIds) {
        await request.delete(`/api/plantings/${id}`).catch(() => {});
      }
      for (const slug of createdPlantSlugs) {
        await request.delete(`/api/plants/${slug}`).catch(() => {});
      }
      // See bed-canvas-drag-pan.spec.ts's own afterEach comment (#14/#210):
      // DELETE /api/beds/{id} 500s while any Action row still references it
      // (every bed gets one for free via generate_bed_tasks on create) -
      // clean those up first so this spec doesn't leave the bed behind for
      // later runs/tests sharing garden_test.
      const actionsRes = await request.get("/api/actions").catch(() => null);
      if (actionsRes?.ok()) {
        const actions = (await actionsRes.json()) as { id: number; bed_id: number | null }[];
        for (const action of actions.filter((a) => a.bed_id === bed.id)) {
          await request.delete(`/api/actions/${action.id}`).catch(() => {});
        }
      }
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
