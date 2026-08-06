import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #193 ("Technical drawing overlay for garden
 * tasks") - no e2e spec existed for this view before. `technicalDrawing.
 * test.ts`'s 8 unit tests cover the pure dimension-line math, but nothing
 * exercised the real page: reaching it via `BedPanel`'s link, whether it
 * actually renders markers/dimension-line annotations, and - the ticket's
 * own headline requirement - whether every displayed distance is genuinely
 * bed-relative (unchanged when the bed moves within the garden), not
 * garden-absolute.
 *
 * The bed-relative check (steps 1 and 4 of the ticket's own "how to test")
 * is verified by comparing the drawing's *raw canvas pixel data* (not a
 * PNG-encoded `screenshot()`, whose own re-compression turned out to be a
 * real, if small, source of nondeterminism between renders - confirmed
 * empirically while writing this: even reloading the exact same
 * unmodified bed's drawing twice occasionally produced a differently-sized
 * PNG) between the bed at two very different world positions, allowing a
 * small pixel-difference tolerance rather than requiring byte-for-byte
 * equality. `TechnicalDrawing.tsx`'s own viewport-fit box is computed from
 * a hardcoded `{x: -DRAWING_MARGIN_CM, y: -DRAWING_MARGIN_CM, ...}` origin,
 * never the bed's real `border_geometry.x`/`y` (confirmed by reading the
 * source directly) - so if this view is genuinely bed-relative, the two
 * renders should match almost exactly regardless of the bed's world
 * position; a small tolerance absorbs incidental rendering jitter
 * (font hinting/antialiasing) without absorbing a real positional bug,
 * which would show up as a large, structural difference, not a handful of
 * stray pixels.
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

async function createPlant(request: APIRequestContext, slug: string, commonName: string, spreadCm: number): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", spread_cm: spreadCm },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createIndividualPlanting(request: APIRequestContext, bedId: number, plantSlug: string, geometry: Rect): Promise<void> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry, planted_date: null, removed_date: null },
    params: { is_initial_state: true },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** Composites every same-sized Konva layer canvas and checks whether any
 * opaque, genuinely-saturated (non-grayscale) pixel exists anywhere in the
 * drawing area - same technique `garden-timeline.spec.ts` uses, since
 * `colorForSlug`'s hash-derived hue isn't worth replicating bit-for-bit to
 * predict an exact color; "some real color rendered somewhere" is what
 * actually matters for "did the marker/dimension-line layer draw
 * anything." */
async function canvasHasAnySaturatedColor(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) continue;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) return true;
    }
    return false;
  });
}

/** Whether at least `minCount` pixels anywhere on the single technical-
 * drawing canvas are close to `target` RGB - used for the dimension-line
 * amber color specifically (a fixed, known hex, unlike the hash-derived
 * marker colors), scanning the whole canvas since exact label positions
 * depend on `fitViewport`'s own scale/offset math. */
async function canvasHasColor(page: Page, target: { r: number; g: number; b: number }, tolerance = 25): Promise<boolean> {
  return page.evaluate(
    ({ target, tolerance }) => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) return false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 200) continue;
        if (Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance) {
          return true;
        }
      }
      return false;
    },
    { target, tolerance },
  );
}

/** The technical-drawing canvas's own raw pixel buffer (width/height +
 * base64-encoded RGBA bytes) - read directly via `getImageData`, not a
 * `screenshot()` PNG re-encode, to avoid that extra compression step's own
 * incidental nondeterminism (see this file's own top-of-file doc). */
async function captureCanvasPixels(page: Page): Promise<{ width: number; height: number; data: string }> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("canvas not found");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { width, height } = canvas;
    const bytes = ctx.getImageData(0, 0, width, height).data;
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { width, height, data: btoa(binary) };
  });
}

/** Fraction of pixels (0-1) that differ by more than `perChannelTolerance`
 * in any RGBA channel between two same-sized captures - a small nonzero
 * result absorbs incidental rendering jitter (font hinting/antialiasing);
 * a large one is a real structural difference. */
function pixelDiffFraction(
  a: { width: number; height: number; data: string },
  b: { width: number; height: number; data: string },
  perChannelTolerance = 20,
): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const bufA = Buffer.from(a.data, "base64");
  const bufB = Buffer.from(b.data, "base64");
  const pixelCount = a.width * a.height;
  let diffCount = 0;
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const differs =
      Math.abs(bufA[i] - bufB[i]) > perChannelTolerance ||
      Math.abs(bufA[i + 1] - bufB[i + 1]) > perChannelTolerance ||
      Math.abs(bufA[i + 2] - bufB[i + 2]) > perChannelTolerance ||
      Math.abs(bufA[i + 3] - bufB[i + 3]) > perChannelTolerance;
    if (differs) diffCount++;
  }
  return diffCount / pixelCount;
}

const DIMENSION_COLOR = { r: 180, g: 83, b: 9 }; // #b45309

test.describe("Technical drawing overlay (#193)", () => {
  test("reachable from BedPanel's own link; renders plant markers and dimension-line annotations, scoped to the right bed", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedName = `E2E TechDrawing Bed ${stamp}`;
    const slug = `e2e-techdrawing-plant-${stamp}`;
    // Kept within the DEFAULT_VIEWPORT's own visible area (world scale=1,
    // no pan) rather than needing "Fit view" - same reasoning `bed-label-
    // overlap.spec.ts`/others in this directory document: a bed's name is
    // Konva-rendered canvas text, not a real DOM element `getByText` could
    // click anyway, so selecting it has to be a real mouse click at a
    // known screen position, which only a predictable (unzoomed) viewport
    // makes reliable without replicating `fitViewport`'s own math.
    const bed = await createBed(request, bedName, rect(40, 40, 200, 150));
    await createPlant(request, slug, `E2E TechDrawing Plant ${stamp}`, 20);
    await createIndividualPlanting(request, bed.id, slug, rect(30, 65, 20, 20));
    await createIndividualPlanting(request, bed.id, slug, rect(140, 65, 20, 20));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Objects" }).click();
      const canvasBox = await page.locator("canvas").first().boundingBox();
      if (!canvasBox) throw new Error("canvas not visible");
      // Click inside the bed's own footprint but clear of either planting
      // marker (world (40,40)-(240,190); plantings sit near y=65-85).
      await page.mouse.click(canvasBox.x + 190, canvasBox.y + 170);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      await page.getByRole("link", { name: "View technical drawing" }).click();
      await expect(page).toHaveURL(new RegExp(`/layout/beds/${bed.id}/technical-drawing$`));
      await expect(page.getByRole("heading", { name: "Technical drawing" })).toBeVisible();
      // The subtitle names this specific bed - confirms the right bed's
      // drawing loaded, not some other/default one.
      await expect(page.getByText(bedName, { exact: false })).toBeVisible();
      await expect(page.getByText(/distances shown are relative to this bed's own edges/)).toBeVisible();

      await page.locator("canvas").first().waitFor();
      await expect.poll(() => canvasHasAnySaturatedColor(page), { message: "no plant marker color rendered on the drawing" }).toBe(true);
      await expect.poll(() => canvasHasColor(page, DIMENSION_COLOR), { message: "no dimension-line amber color rendered on the drawing" }).toBe(true);
    } finally {
      const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; bed_id: number }[];
      for (const p of plantings.filter((p) => p.bed_id === bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("every displayed distance is bed-relative, not garden-absolute - moving the bed leaves the drawing pixel-identical", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedName = `E2E TechDrawing Move Bed ${stamp}`;
    const slug = `e2e-techdrawing-move-plant-${stamp}`;
    const bed = await createBed(request, bedName, rect(50, 50, 200, 150));
    await createPlant(request, slug, `E2E TechDrawing Move Plant ${stamp}`, 20);
    await createIndividualPlanting(request, bed.id, slug, rect(30, 65, 20, 20));
    await createIndividualPlanting(request, bed.id, slug, rect(140, 65, 20, 20));

    try {
      await page.goto(`/layout/beds/${bed.id}/technical-drawing`);
      await expect(page.getByRole("heading", { name: "Technical drawing" })).toBeVisible();
      const canvas = page.locator("canvas").first();
      await canvas.waitFor();
      await expect.poll(() => canvasHasAnySaturatedColor(page)).toBe(true); // let it fully render first
      // "Has some color" alone isn't "fully settled" - fonts/labels can
      // still be finishing a beat later even once *some* saturated pixel
      // is already on screen.
      await page.waitForTimeout(500);
      const pixelsBefore = await captureCanvasPixels(page);

      // Move the bed far away in world space - same width/height, wildly
      // different x/y - then reload the same drawing.
      const moveRes = await request.patch(`/api/beds/${bed.id}`, {
        data: { border_geometry: rect(2500, 3100, 200, 150) },
      });
      expect(moveRes.ok(), `failed to move bed: ${moveRes.status()}`).toBeTruthy();

      await page.reload();
      await expect(page.getByRole("heading", { name: "Technical drawing" })).toBeVisible();
      const canvasAfter = page.locator("canvas").first();
      await canvasAfter.waitFor();
      await expect.poll(() => canvasHasAnySaturatedColor(page)).toBe(true);
      await page.waitForTimeout(500);
      const pixelsAfter = await captureCanvasPixels(page);

      // A small tolerance (font hinting/antialiasing jitter - confirmed
      // empirically while writing this test: even reloading the exact
      // same *unmoved* bed's drawing twice can differ by a stray pixel or
      // two) - 0.5% of the canvas is generous headroom for that while
      // still catching any real structural difference (a whole marker/
      // dimension-line rendered in a different place would move thousands
      // of pixels, not a handful).
      const diffFraction = pixelDiffFraction(pixelsBefore, pixelsAfter);
      expect(
        diffFraction,
        `technical drawing's rendered pixels differ by ${(diffFraction * 100).toFixed(2)}% after moving the bed to a new world position - distances are not actually bed-relative`,
      ).toBeLessThan(0.005);
    } finally {
      const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; bed_id: number }[];
      for (const p of plantings.filter((p) => p.bed_id === bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
