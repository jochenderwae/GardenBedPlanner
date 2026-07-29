import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #209 ("Canvas UI to draw/connect physical
 * irrigation parts") - the implementer's own outcome comment explicitly
 * left the drag-to-connect gesture, anchor positioning, and bowed/dashed
 * edge rendering unverified (no browser-automation tool available). Covers
 * the ticket's own "how to test" steps 1-6 (step 7 - zone-based/bed-placed
 * equipment unaffected - is already covered by the pre-existing
 * `equipment-inventory-workflow.spec.ts`, not duplicated here).
 *
 * Node/anchor positions are computed directly from `PipeNetworkDialog.tsx`'s
 * own constants (`nextCascadePosition`, `NODE_WIDTH`/`NODE_HEIGHT`,
 * `pointOnRectPerimeter`) rather than guessed - the dialog's canvas has no
 * pan/zoom (confirmed: no `scaleX`/`scaleY` on its `<Stage>`), so local
 * diagram coordinates map directly onto canvas-local pixels. The dialog's
 * own Konva `<canvas>` is uniquely scoped via `page.getByRole("dialog")`
 * (confirmed empirically to match exactly one canvas element, unlike the
 * main layout canvas which composites several stacked layers - no
 * multi-layer compositing needed here).
 */

async function createIrrigationPart(
  request: APIRequestContext,
  name: string,
  partType: string,
  quantityOnHand: number,
  connectorSizeMm: number | null = null,
): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-parts", {
    data: { name, part_type: partType, quantity_on_hand: quantityOnHand, notes: "", connector_size_mm: connectorSizeMm, diagram_x: null, diagram_y: null },
  });
  expect(res.ok(), `failed to create irrigation part "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function openPipeNetworkDialog(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Equipment" }).click();
  await page.getByRole("button", { name: "Pipe network" }).click();
  await expect(page.getByRole("dialog").getByText("Pipe network")).toBeVisible();
}

function dialogCanvas(page: Page) {
  return page.getByRole("dialog").locator("canvas");
}

/** Adds a specific part (scoped by its own name, never a bare `.first()`
 * position-based lookup) to the diagram and waits for that exact row to
 * flip to "On diagram" before returning - two back-to-back `.first()`
 * clicks with no settle wait between them was found to race the
 * `updatePartMutation`'s async round trip (both clicks could land on the
 * same still-not-yet-re-rendered row), silently adding neither part. */
/** The specific `PartRow` container for a given part name - neither
 * `.first()` nor `.last()` on a bare `div[hasText]` filter reliably picks
 * this out: every ancestor div containing the name text also matches
 * (the whole parts-list wrapper - which contains *every* row's own "Add to
 * diagram" button, not just this one - down to the innermost name-only
 * leaf div with no button descendant at all), and document order doesn't
 * put the actual row container reliably at either end of that set
 * (confirmed empirically - both `.first()` and `.last()` were tried and
 * failed in different ways while writing this spec). `PartRow`'s own root
 * div is the nearest text ancestor carrying `rounded` in its class list
 * (`"flex flex-col gap-1 rounded px-1.5 py-1.5 ..."` - no other div in this
 * component tree has that class), which XPath's `ancestor::` axis can
 * target directly regardless of exactly how many list/wrapper divs sit
 * above it. */
function partRow(page: Page, partName: string) {
  return page
    .getByRole("dialog")
    .getByText(partName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'rounded')][1]");
}

async function addPartToDiagram(page: Page, partName: string): Promise<void> {
  const row = partRow(page, partName);
  await row.getByRole("button", { name: "Add to diagram" }).click();
  await expect(row.getByRole("button", { name: "On diagram" })).toBeVisible();
}

async function canvasBox(page: Page) {
  const box = await dialogCanvas(page).boundingBox();
  if (!box) throw new Error("pipe network canvas not visible");
  return box;
}

/** Scans a rectangular CSS-pixel region of the dialog's own single Konva
 * canvas for an opaque pixel close to `target` RGB - no multi-layer
 * compositing needed (confirmed only one canvas element renders inside the
 * dialog, unlike the main layout canvas). */
async function regionContainsColor(
  page: Page,
  cssX: number,
  cssY: number,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
  tolerance = 30,
): Promise<boolean> {
  return dialogCanvas(page).evaluate(
    (canvasEl, { cssX, cssY, width, height, target, tolerance }) => {
      const canvas = canvasEl as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const scaleX = canvas.width / box.width;
      const scaleY = canvas.height / box.height;
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const localX = Math.round((cssX + dx - box.left) * scaleX);
          const localY = Math.round((cssY + dy - box.top) * scaleY);
          if (localX < 0 || localY < 0 || localX >= canvas.width || localY >= canvas.height) continue;
          const [r, g, b, a] = ctx.getImageData(localX, localY, 1, 1).data;
          if (a < 200) continue;
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

const NODE_STROKE = { r: 8, g: 145, b: 178 }; // #0891b2
const NODE_NEEDS_PURCHASE_STROKE = { r: 220, g: 38, b: 38 }; // #dc2626
const MISMATCH_LABEL_COLOR = { r: 217, g: 119, b: 6 }; // #d97706

// PipeNetworkDialog.tsx's own nextCascadePosition: index 0 -> (100, 80),
// index 1 -> (140, 120), both local diagram coordinates.
const NODE_A_POS = { x: 100, y: 80 };
const NODE_B_POS = { x: 140, y: 120 };
const NODE_HALF_HEIGHT = 28; // NODE_HEIGHT / 2

test.describe("Pipe network dialog (#209)", () => {
  test("adding a part to the diagram renders a real node on the canvas", async ({ page, request }) => {
    const stamp = Date.now();
    const part = await createIrrigationPart(request, `E2E Pipe Solo ${stamp}`, "nozzle", 1);

    try {
      await openPipeNetworkDialog(page);
      await expect(page.getByRole("dialog").getByText(`E2E Pipe Solo ${stamp}`)).toBeVisible();

      await page.getByRole("dialog").getByRole("button", { name: "Add to diagram" }).click();
      await expect(page.getByRole("dialog").getByRole("button", { name: "On diagram" })).toBeVisible();

      const box = await canvasBox(page);
      await expect
        .poll(
          async () => regionContainsColor(page, box.x + NODE_A_POS.x - 60, box.y + NODE_A_POS.y - 28, 120, 56, NODE_STROKE),
          { message: "no node stroke color found at the expected cascade position after adding to diagram", timeout: 5000 },
        )
        .toBe(true);
    } finally {
      await request.delete(`/api/irrigation-parts/${part.id}`).catch(() => {});
    }
  });

  test("dragging from a spare anchor onto another node's body creates a connection that persists across reopening the dialog", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const partA = await createIrrigationPart(request, `E2E Pipe A ${stamp}`, "t_junction", 1);
    const partB = await createIrrigationPart(request, `E2E Pipe B ${stamp}`, "nozzle", 1);

    try {
      await openPipeNetworkDialog(page);
      await addPartToDiagram(page, `E2E Pipe A ${stamp}`); // -> (100, 80)
      await addPartToDiagram(page, `E2E Pipe B ${stamp}`); // -> (140, 120)

      const box = await canvasBox(page);
      const anchorA = { x: box.x + NODE_A_POS.x, y: box.y + NODE_A_POS.y - NODE_HALF_HEIGHT }; // A's top anchor
      const bodyB = { x: box.x + NODE_B_POS.x, y: box.y + NODE_B_POS.y };

      await page.mouse.move(anchorA.x, anchorA.y);
      await page.mouse.down();
      await page.mouse.move(bodyB.x, bodyB.y, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => {
          const conns = (await (await request.get("/api/irrigation-connections")).json()) as {
            from_part_id: number;
            to_part_id: number;
          }[];
          return conns.some(
            (c) =>
              (c.from_part_id === partA.id && c.to_part_id === partB.id) ||
              (c.from_part_id === partB.id && c.to_part_id === partA.id),
          );
        }, { message: "drag from the spare anchor onto the target node never created a connection", timeout: 5000 })
        .toBe(true);

      // Persists across closing and reopening the dialog.
      await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openPipeNetworkDialog(page);
      await expect
        .poll(async () => {
          const box2 = await canvasBox(page);
          return regionContainsColor(page, box2.x + 100, box2.y + 80, 160, 80, NODE_STROKE);
        })
        .toBe(true);
    } finally {
      const conns = (await (await request.get("/api/irrigation-connections")).json()) as { id: number; from_part_id: number }[];
      for (const c of conns.filter((c) => c.from_part_id === partA.id || c.from_part_id === partB.id)) {
        await request.delete(`/api/irrigation-connections/${c.id}`).catch(() => {});
      }
      await request.delete(`/api/irrigation-parts/${partA.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${partB.id}`).catch(() => {});
    }
  });

  test("a connector-size mismatch between connected parts is flagged visually but doesn't block the connection", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const partA = await createIrrigationPart(request, `E2E Pipe Mismatch A ${stamp}`, "hose_segment", 1, 13);
    const partB = await createIrrigationPart(request, `E2E Pipe Mismatch B ${stamp}`, "dripper", 1, 4.6);

    try {
      await openPipeNetworkDialog(page);
      await addPartToDiagram(page, `E2E Pipe Mismatch A ${stamp}`);
      await addPartToDiagram(page, `E2E Pipe Mismatch B ${stamp}`);

      const box = await canvasBox(page);

      // The two default cascade positions (100,80) and (140,120) are only
      // ~57px apart center-to-center - well within these 120x56 nodes' own
      // footprints, so they visually overlap. Konva paints nodes *after*
      // edges in this Layer's own child order, so an edge drawn entirely
      // between two overlapping node bodies (and its mismatch label) would
      // be fully occluded by the node rectangles on top - confirmed via a
      // debug screenshot while writing this test. Dragging node B well
      // clear of node A first gives the edge a real, unoccluded midpoint
      // to render its label in.
      const bodyBDefault = { x: box.x + NODE_B_POS.x, y: box.y + NODE_B_POS.y };
      const NODE_B_MOVED_POS = { x: 340, y: 80 };
      const bodyBMoved = { x: box.x + NODE_B_MOVED_POS.x, y: box.y + NODE_B_MOVED_POS.y };
      await page.mouse.move(bodyBDefault.x, bodyBDefault.y);
      await page.mouse.down();
      await page.mouse.move(bodyBMoved.x, bodyBMoved.y, { steps: 10 });
      await page.mouse.up();

      const anchorA = { x: box.x + NODE_A_POS.x, y: box.y + NODE_A_POS.y - NODE_HALF_HEIGHT };
      await page.mouse.move(anchorA.x, anchorA.y);
      await page.mouse.down();
      await page.mouse.move(bodyBMoved.x, bodyBMoved.y, { steps: 10 });
      await page.mouse.up();

      // The connection is not blocked - it's created and reflected in the
      // real API data despite the mismatched sizes (advisory only, per the
      // ticket's own "13mm supply -> 4.6mm Micro-Drip via a reducer is a
      // legitimate configuration, never an error" requirement).
      await expect
        .poll(async () => {
          const conns = (await (await request.get("/api/irrigation-connections")).json()) as {
            from_part_id: number;
            to_part_id: number;
          }[];
          return conns.some(
            (c) =>
              (c.from_part_id === partA.id && c.to_part_id === partB.id) ||
              (c.from_part_id === partB.id && c.to_part_id === partA.id),
          );
        })
        .toBe(true);

      // The mismatch label ("13 -> 4.6mm") renders in amber somewhere in
      // the now-clear gap between the two nodes.
      const midX = box.x + (NODE_A_POS.x + NODE_B_MOVED_POS.x) / 2;
      const midY = box.y + (NODE_A_POS.y + NODE_B_MOVED_POS.y) / 2;
      await expect
        .poll(
          async () => regionContainsColor(page, midX - 70, midY - 40, 140, 80, MISMATCH_LABEL_COLOR),
          { message: "no mismatch-label amber color found near the connection's midpoint", timeout: 5000 },
        )
        .toBe(true);
    } finally {
      const conns = (await (await request.get("/api/irrigation-connections")).json()) as { id: number; from_part_id: number }[];
      for (const c of conns.filter((c) => c.from_part_id === partA.id || c.from_part_id === partB.id)) {
        await request.delete(`/api/irrigation-connections/${c.id}`).catch(() => {});
      }
      await request.delete(`/api/irrigation-parts/${partA.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${partB.id}`).catch(() => {});
    }
  });

  test("a part needing more connections than it has in stock shows 'Needs purchase' in the left panel and a red node on the canvas", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const partA = await createIrrigationPart(request, `E2E Pipe Stock A ${stamp}`, "t_junction", 5);
    const partB = await createIrrigationPart(request, `E2E Pipe Stock B ${stamp}`, "nozzle", 5);

    try {
      await openPipeNetworkDialog(page);
      const dialog = page.getByRole("dialog");
      await addPartToDiagram(page, `E2E Pipe Stock A ${stamp}`);
      await addPartToDiagram(page, `E2E Pipe Stock B ${stamp}`);

      const box = await canvasBox(page);
      const anchorA = { x: box.x + NODE_A_POS.x, y: box.y + NODE_A_POS.y - NODE_HALF_HEIGHT };
      const bodyB = { x: box.x + NODE_B_POS.x, y: box.y + NODE_B_POS.y };
      await page.mouse.move(anchorA.x, anchorA.y);
      await page.mouse.down();
      await page.mouse.move(bodyB.x, bodyB.y, { steps: 10 });
      await page.mouse.up();
      await expect
        .poll(async () => (await (await request.get("/api/irrigation-connections")).json()).length > 0)
        .toBe(true);

      // Reduce part A's stock below its now-real connection count (1) via
      // the left panel's own inline-editable quantity field.
      const rowA = partRow(page, `E2E Pipe Stock A ${stamp}`);
      const qtyInput = rowA.getByPlaceholder("qty");
      await qtyInput.fill("0");
      await qtyInput.blur();

      await expect(dialog.getByText(/Needs purchase · have 0, need 1/)).toBeVisible();

      await expect
        .poll(
          async () => regionContainsColor(page, box.x + NODE_A_POS.x - 60, box.y + NODE_A_POS.y - 28, 120, 56, NODE_NEEDS_PURCHASE_STROKE),
          { message: "no needs-purchase red stroke found on the under-stocked node", timeout: 5000 },
        )
        .toBe(true);
    } finally {
      const conns = (await (await request.get("/api/irrigation-connections")).json()) as { id: number; from_part_id: number }[];
      for (const c of conns.filter((c) => c.from_part_id === partA.id || c.from_part_id === partB.id)) {
        await request.delete(`/api/irrigation-connections/${c.id}`).catch(() => {});
      }
      await request.delete(`/api/irrigation-parts/${partA.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${partB.id}`).catch(() => {});
    }
  });

  test("deleting a part with connections shows a cascade-confirm dialog; confirming removes both the part and its connections", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const partA = await createIrrigationPart(request, `E2E Pipe Delete A ${stamp}`, "t_junction", 1);
    const partB = await createIrrigationPart(request, `E2E Pipe Delete B ${stamp}`, "nozzle", 1);
    const connRes = await request.post("/api/irrigation-connections", {
      data: { from_part_id: partA.id, to_part_id: partB.id, notes: "" },
    });
    expect(connRes.ok(), `failed to seed connection: ${connRes.status()}`).toBeTruthy();
    const connection = await connRes.json();

    try {
      await openPipeNetworkDialog(page);
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: `Delete E2E Pipe Delete A ${stamp}` }).click();

      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByText(/1 connection\(s\)/)).toBeVisible();
      await confirmDialog.getByRole("button", { name: "Delete" }).click();

      await expect(dialog.getByText(`E2E Pipe Delete A ${stamp}`)).toHaveCount(0);
      await expect
        .poll(async () => (await request.get(`/api/irrigation-parts/${partA.id}`)).status())
        .toBe(404);
      await expect
        .poll(async () => (await request.get(`/api/irrigation-connections/${connection.id}`)).status())
        .toBe(404);
    } finally {
      await request.delete(`/api/irrigation-parts/${partA.id}`).catch(() => {});
      await request.delete(`/api/irrigation-parts/${partB.id}`).catch(() => {});
    }
  });
});
