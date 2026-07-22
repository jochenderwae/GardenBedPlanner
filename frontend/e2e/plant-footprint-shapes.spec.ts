import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Visual regression coverage for #132 ("growth_habit: render distinct
 * plant footprint shapes in layout editor") - the ticket's own outcome
 * comment explicitly says the 4 manual "How to test" steps need "an actual
 * human/tester pass with the canvas open", since Konva draws to `<canvas>`
 * with no DOM representation Vitest/jsdom or a typecheck could inspect.
 *
 * Rather than a full pixel-perfect shape recognizer, this reads real pixel
 * data straight out of the live `<canvas>` elements via
 * `CanvasRenderingContext2D.getImageData` (see `samplePixel` below) to
 * check the one distinction that's both mechanically easy to get wrong and
 * cheap to verify precisely: a "rosette" plant's footprint (`PlantFootprint.tsx`'s
 * `Ring`, inner radius 40% of outer) must be *hollow* at its exact center,
 * unlike every other shape (including the pre-#132 all-circles fallback),
 * which is solid there - directly proves the shape mapping actually wired
 * up instead of quietly falling back to circles for everything. The other
 * four habits (upright/climbing/spreading/tree) get a lighter "something
 * opaque actually rendered where expected, the canvas didn't silently fail
 * to draw them" smoke check.
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
  growthHabit: string | null,
): Promise<{ slug: string }> {
  const res = await request.post("/api/plants", {
    data: {
      slug,
      // Deliberately short (not the full, timestamp-suffixed slug) - each
      // marker's canvas label renders this at fontSize 10 to the right of
      // its shape, and a too-long label from one marker can visually
      // overlap the next marker 100cm over, contaminating that neighbor's
      // "sample the exact center pixel" check with anti-aliased text glyph
      // edges instead of the shape itself (this is exactly what happened on
      // the first pass writing this spec - see git history).
      common_name: commonName,
      botanical_name: "Testus e2eus",
      growth_habit: growthHabit,
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
    data: {
      bed_id: bedId,
      plant_slug: plantSlug,
      placement_type: "individual",
      geometry,
      planted_date: null,
      removed_date: null,
    },
  });
  expect(res.ok(), `failed to create planting for "${plantSlug}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Reads a single pixel's true composited RGBA at a CSS-pixel page
 * position - i.e. what a human actually sees there, not just whichever
 * individual Konva `<canvas>` happens to have content.
 *
 * react-konva renders one `<canvas>` per `<Layer>` (grid, garden/beds,
 * plant markers, ...), all absolutely stacked on top of each other in DOM
 * order with transparent backgrounds - what's visible at any pixel is the
 * standard "source-over" alpha composite of every layer's canvas, bottom
 * to top. An earlier version of this helper instead returned the first
 * non-transparent pixel found searching layers top-down, which was wrong
 * whenever the *topmost* layer legitimately had nothing there (e.g. a
 * rosette's hollow ring center) - it kept falling through to a solid layer
 * underneath (the bed's own fill) and misreported "something's there".
 * Compositing every same-sized canvas onto a scratch canvas via
 * `drawImage` (in DOM order, so the browser's own 2D compositing does the
 * blending) reconstructs the real answer directly, sidestepping needing to
 * know which specific canvas belongs to which Layer at all. Canvases are
 * filtered to those sharing the query canvas's own CSS box - Konva's
 * layers are always identically sized/positioned, so this is enough to
 * exclude any unrelated canvas elsewhere on the page without needing to
 * reason about DOM structure. */
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

test.describe("Plant footprint shapes by growth_habit (#132)", () => {
  test("rosette renders a hollow ring (not a filled circle); every habit renders something visible", async ({
    page,
    request,
  }) => {
    // 150cm spacing between marker centers - wide enough that even a
    // fairly long canvas label (fontSize 10, drawn to the right of its
    // shape) from one marker can't reach into its neighbor's sample point.
    const bed = await createBed(request, "E2E Footprint Bed", rect(37, 37, 990));
    const suffix = Date.now();
    const habits: { habit: string | null; localX: number }[] = [
      { habit: "upright", localX: 33 },
      { habit: "climbing", localX: 183 },
      { habit: "spreading", localX: 333 },
      { habit: "rosette", localX: 483 },
      { habit: "tree", localX: 633 },
      { habit: null, localX: 783 }, // no growth_habit set - the pre-#132 fallback circle
    ];
    const size = 40; // -> PlantFootprint radius 20
    const localY = 33;

    const createdPlantSlugs: string[] = [];
    const createdPlantingIds: number[] = [];
    for (const { habit, localX } of habits) {
      const slug = `e2e-footprint-${habit ?? "none"}-${suffix}`;
      await createPlant(request, slug, habit ?? "none", habit);
      createdPlantSlugs.push(slug);
      const planting = await createPlanting(request, bed.id, slug, rect(localX, localY, size));
      createdPlantingIds.push(planting.id);
    }

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await page.getByRole("tab", { name: "Plants" }).click();
      // Settle: give the just-mounted PlantPlacementLayer a moment to
      // actually paint before sampling pixels - a rare flake without this
      // (~1 in 15 runs) suggests the canvas draw can lag one animation
      // frame behind the tab-switch React re-render.
      await page.waitForTimeout(200);

      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");

      // World/screen center of each marker = bed's own world position (37,37)
      // + this planting's bed-local center (localX/Y + size/2).
      const centerOf = (localX: number) => ({
        x: box.x + 37 + localX + size / 2,
        y: box.y + 37 + localY + size / 2,
      });

      // A point that's inside the bed (so it shares the same bed-fill
      // background every sample point below sits on top of) but nowhere
      // near any marker or its label - the "nothing drawn here but the bed
      // itself" baseline every other sample is compared against. Every
      // check below is comparative (differs from / matches this control),
      // not "is this pixel non-transparent" - since `samplePixel` composites
      // every layer including the bed's own opaque fill, *every* point
      // inside the bed is non-transparent regardless of whether a plant
      // marker is drawn there too.
      const control = { x: box.x + 37 + 900, y: box.y + 37 + 150 };
      const controlPixel = await samplePixel(page, control.x, control.y);
      expect(controlPixel, "control point (bare bed background) must itself render as something visible").not.toBeNull();

      function expectDifferentFromControl(pixel: { r: number; g: number; b: number; a: number } | null, msg: string) {
        expect(pixel, msg).not.toBeNull();
        expect(pixel).not.toEqual(controlPixel);
      }

      for (const { habit, localX } of habits) {
        const { x, y } = centerOf(localX);
        if (habit === "rosette") {
          const centerPixel = await samplePixel(page, x, y);
          expect(centerPixel, "rosette's exact center must be hollow - just the bed showing through, same as the control point").toEqual(
            controlPixel,
          );
          // But the ring itself is there - just off-center, e.g. straight up
          // from the middle at the midpoint between inner (8px) and outer
          // (20px) radius.
          const ringPixel = await samplePixel(page, x, y - 14);
          expectDifferentFromControl(ringPixel, "the rosette ring's stroke/fill must render somewhere in its annulus");
        } else if (habit === "tree") {
          // Sample well up into the canopy circle (centered 0.15*radius
          // above the anchor, 0.75*radius across) rather than the anchor
          // point itself, which sits right at the narrow (0.24*radius-wide)
          // trunk's top edge - a much smaller, rounding-sensitive target.
          const pixel = await samplePixel(page, x, y - 10);
          expectDifferentFromControl(pixel, "tree's canopy must render as something visibly different from bare bed");
        } else {
          const pixel = await samplePixel(page, x, y);
          expectDifferentFromControl(pixel, `${habit ?? "no-habit-set fallback"}'s center must render as something visibly different from bare bed`);
        }
      }
    } finally {
      for (const id of createdPlantingIds) {
        await request.delete(`/api/plantings/${id}`).catch(() => {});
      }
      for (const slug of createdPlantSlugs) {
        await request.delete(`/api/plants/${slug}`).catch(() => {});
      }
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
