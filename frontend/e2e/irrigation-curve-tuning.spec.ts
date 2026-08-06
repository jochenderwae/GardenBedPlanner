import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #279 ("Irrigation editor: re-tune curve/anchor
 * visual constants against real usage"). The implementer's own outcome
 * comment verified the re-tuned `BEZIER_CONTROL_MIN_PX`/`BEZIER_CONTROL_MAX_PX`/
 * `DUPLICATE_OFFSET_STEP_PX` constants only via a throwaway, uncommitted
 * Playwright screenshot script against manually-seeded data. The ticket's own
 * framing is explicit that the exact values are a subjective call for
 * ui-ux-designer/the user to refine further - this isn't re-litigating that
 * judgment. What *is* this tester's job: confirm the re-tuned constants
 * didn't break the thing they exist to guarantee - that two duplicate
 * connections between the same pair of instances still render as genuinely
 * distinct curves (a real visible gap between them, not collapsed on top of
 * each other) - and that the irrigation layer still renders real connection
 * geometry at both a zoomed-in and zoomed-out level, the two extremes the
 * ticket's own "How to test" calls out.
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

async function createPart(request: APIRequestContext, name: string, partType: string, quantityOnHand = 5): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-parts", {
    data: { name, part_type: partType, quantity_on_hand: quantityOnHand, notes: "", connector_size_mm: null },
  });
  expect(res.ok(), `failed to create irrigation part "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createInstance(
  request: APIRequestContext,
  data: { part_id: number; bed_id: number; geometry: Rect },
): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-part-instances", {
    data: { garden_id: null, diagram_x: null, diagram_y: null, ...data },
  });
  expect(res.ok(), `failed to create irrigation part instance: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createConnection(request: APIRequestContext, fromId: number, toId: number): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-connections", {
    data: { from_instance_id: fromId, to_instance_id: toId, notes: "" },
  });
  expect(res.ok(), `failed to create connection: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function openEquipmentTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Equipment" }).click();
  await expect(page.getByRole("heading", { name: "Irrigation parts" })).toBeVisible();
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

const NODE_STROKE = { r: 8, g: 145, b: 178 }; // #0891b2, IrrigationLayer.tsx's NODE_STROKE

/** Whether the connection-edge stroke color is present anywhere in the
 * given rectangular CSS-pixel region - same composite-every-Konva-layer
 * technique `bed-label-overlap.spec.ts`/`rotation-warning.spec.ts` already
 * establish for this app's canvas specs. */
async function regionContainsColor(
  page: Page,
  cssX: number,
  cssY: number,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
  tolerance = 25,
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
          if (a < 120) continue; // duplicate curves render at opacity 0.6, not fully opaque
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

/** Contiguous CSS-pixel-row bands (within `yFrom`..`yTo`, scanning the full
 * `xFrom`..`xFrom+xWidth` width on each row) where the stroke color is
 * present anywhere, returned as each band's own vertical center - used to
 * tell "one wide curve" from "two genuinely separate curves with a gap
 * between them" without needing to replicate `connectionGeometry`'s own
 * control-point/anchor-slot math to predict the curve's exact position
 * (anchor count/slot depends on how many other connections already touch
 * each instance, which shifts anchors away from the simple top/bottom pair
 * a zero-connection instance would get). */
async function colorBandCenters(
  page: Page,
  xFrom: number,
  xWidth: number,
  yFrom: number,
  yTo: number,
  target: { r: number; g: number; b: number },
): Promise<number[]> {
  const hits: boolean[] = [];
  for (let y = yFrom; y <= yTo; y++) {
    hits.push(await regionContainsColor(page, xFrom, y, xWidth, 1, target));
  }
  const centers: number[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i] && bandStart === null) bandStart = i;
    if (!hits[i] && bandStart !== null) {
      centers.push(yFrom + (bandStart + i - 1) / 2);
      bandStart = null;
    }
  }
  if (bandStart !== null) centers.push(yFrom + (bandStart + hits.length - 1) / 2);
  return centers;
}

test.describe("Irrigation curve/anchor tuning - no regression from the #279 re-tune", () => {
  test("two duplicate connections between the same instance pair render as genuinely distinct curves, not collapsed on top of each other", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    // Bed geometry itself is world-absolute, but IrrigationLayer.tsx's own
    // `instanceWorldPosition` treats a bed-anchored instance's `geometry` as
    // bed-*local* (`bedRect.x + center.x`, same convention plantings/
    // equipment use) - confirmed empirically while writing this test (an
    // initial attempt passing world coordinates as `geometry` rendered the
    // connection far from where the math below expected it, entirely
    // missing the scan window). Bed at world (100,100)-(600,400); instance
    // centers below are bed-local (53,153) and (443,153) -> world (153,253)
    // and (543,253).
    const bed = await createBed(request, `E2E Curve Tuning Bed ${stamp}`, rect(100, 100, 500, 300));
    const part = await createPart(request, `E2E Curve Tuning Part ${stamp}`, `e2e-curve-tuning-type-${stamp}`);
    // Two instances far apart horizontally, vertically centered in the bed -
    // a duplicate connection's own bow should read as a clear vertical
    // separation around their shared midpoint.
    const instanceA = await createInstance(request, { part_id: part.id, bed_id: bed.id, geometry: rect(50, 150, 6, 6) });
    const instanceB = await createInstance(request, { part_id: part.id, bed_id: bed.id, geometry: rect(440, 150, 6, 6) });
    const connectionFirst = await createConnection(request, instanceA.id, instanceB.id);
    const connectionSecond = await createConnection(request, instanceA.id, instanceB.id);

    try {
      await openEquipmentTab(page);
      const box = await canvasBox(page);

      // World midpoint between the two instance centers: y = 253 (world
      // scale 1, no pan). Scans the whole horizontal span between the two
      // nodes at once, per row - a row counts as "hit" if the stroke color
      // appears anywhere across that width. This can't report a trustworthy
      // *gap distance* (each curve bows across nearly the whole vertical
      // range somewhere along its own length, so the two curves' own "color
      // anywhere in this row" envelopes overlap almost entirely even where
      // they're genuinely well apart at any single x - confirmed
      // empirically while writing this test, attempting a narrower
      // column-by-column distance measurement first), but it *does*
      // reliably distinguish the actual failure mode this constant exists
      // to prevent: 2 separate bands means 2 genuinely distinct curves,
      // 1 band means they've collapsed into what reads as a single curve.
      const midY = box.y + 253;
      const scanXFrom = box.x + 153;
      const scanXWidth = 543 - 153;

      await expect
        .poll(() => colorBandCenters(page, scanXFrom, scanXWidth, midY - 80, midY + 80, NODE_STROKE).then((c) => c.length), {
          message:
            "expected 2 visually distinct duplicate-connection curve bands around the shared midpoint - the re-tuned DUPLICATE_OFFSET_STEP_PX may have collapsed them back into 1",
        })
        .toBe(2);
    } finally {
      await request.delete(`/api/irrigation-connections/${connectionFirst.id}`).catch(() => {});
      await request.delete(`/api/irrigation-connections/${connectionSecond.id}`).catch(() => {});
      await request.delete(`/api/irrigation-part-instances/${instanceA.id}`).catch(() => {});
      await request.delete(`/api/irrigation-part-instances/${instanceB.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${part.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("connection curves still render real geometry at a zoomed-in and a zoomed-out level", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Curve Zoom Bed ${stamp}`, rect(100, 100, 300, 200));
    const part = await createPart(request, `E2E Curve Zoom Part ${stamp}`, `e2e-curve-zoom-type-${stamp}`);
    const instanceA = await createInstance(request, { part_id: part.id, bed_id: bed.id, geometry: rect(120, 200, 6, 6) });
    const instanceB = await createInstance(request, { part_id: part.id, bed_id: bed.id, geometry: rect(320, 200, 6, 6) });
    const connection = await createConnection(request, instanceA.id, instanceB.id);

    try {
      await openEquipmentTab(page);
      const box = await canvasBox(page);
      // Bed-local geometry centers (123,203)/(323,203) + bed's own world
      // offset (100,100) -> world (223,303)/(423,303); midpoint (323,303).
      const midX = box.x + 323;
      const midY = box.y + 303;

      // Zoom in (ctrl+scroll up) centered on the connection's own midpoint -
      // Layout.tsx's own wheel handler only zooms (vs. pans) when
      // e.evt.ctrlKey is set, so Control must be held for the duration of
      // the wheel gesture.
      await page.mouse.move(midX, midY);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -400);
      await page.keyboard.up("Control");
      await page.waitForTimeout(150);
      await expect
        .poll(() => regionContainsColor(page, box.x, box.y, box.width, box.height, NODE_STROKE), {
          message: "no connection-edge color rendered anywhere on canvas at a zoomed-in level",
        })
        .toBe(true);

      // Zoom back out past the default and further out.
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 1600);
      await page.keyboard.up("Control");
      await page.waitForTimeout(150);
      await expect
        .poll(() => regionContainsColor(page, box.x, box.y, box.width, box.height, NODE_STROKE), {
          message: "no connection-edge color rendered anywhere on canvas at a zoomed-out level",
        })
        .toBe(true);
    } finally {
      await request.delete(`/api/irrigation-connections/${connection.id}`).catch(() => {});
      await request.delete(`/api/irrigation-part-instances/${instanceA.id}`).catch(() => {});
      await request.delete(`/api/irrigation-part-instances/${instanceB.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${part.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
