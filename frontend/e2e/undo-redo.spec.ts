import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #18 ("Undo/redo for canvas geometry moves/
 * resizes") - `history.ts`'s pure stack logic already has solid Vitest
 * coverage (`history.test.ts`), but not whether `Layout.tsx` actually wires
 * a real drag/resize gesture into a push, or whether Ctrl+Z/Ctrl+Shift+Z
 * actually walks that stack against the real API - which needs a real
 * keyboard + Konva pointer system neither typecheck nor jsdom has. The
 * implementer's own outcome comment confirms verification stopped at
 * build/lint/test level.
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

async function pollBedX(request: APIRequestContext, bedId: number): Promise<number> {
  return (await (await request.get(`/api/beds/${bedId}`)).json()).border_geometry.x;
}

test.describe("Undo/redo (#18)", () => {
  test("bed drag: undo reverts, redo reapplies, a new change after undo clears redo, toolbar buttons track availability", async ({
    page,
    request,
  }) => {
    // Deliberately small and positioned close to the origin (all movements
    // below stay within (0,0)-(400,250)) - this file's "garden boundary
    // resize" test creates a real Garden with no way to delete it via the
    // API afterward (see that test's own comment), so on a later repeat
    // run of this spec a Garden may already exist and clamp bed drags to
    // its bounds; staying safely inside any garden at least this size
    // avoids that cross-test order-dependency entirely rather than fighting
    // it.
    const bed = await createBed(request, "E2E Undo Bed", rect(50, 50, 60, 60));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const undoButton = page.getByRole("button", { name: "Undo" });
      const redoButton = page.getByRole("button", { name: "Redo" });
      await expect(undoButton).toBeDisabled();
      await expect(redoButton).toBeDisabled();

      const box = await canvasBox(page);
      // Drag +80cm right (grid-aligned, no alignment-snap interference -
      // only bed on the canvas).
      await page.mouse.move(box.x + 80, box.y + 80);
      await page.mouse.down();
      await page.mouse.move(box.x + 160, box.y + 80, { steps: 10 });
      await page.mouse.up();

      await expect.poll(() => pollBedX(request, bed.id), { message: "drag never persisted" }).toBe(130);
      await expect(undoButton).toBeEnabled();
      await expect(redoButton).toBeDisabled();

      // Ctrl+Z reverts it.
      await page.keyboard.press("Control+z");
      await expect.poll(() => pollBedX(request, bed.id), { message: "Ctrl+Z never reverted the drag" }).toBe(50);
      await expect(undoButton).toBeDisabled();
      await expect(redoButton).toBeEnabled();

      // Ctrl+Shift+Z reapplies it.
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(() => pollBedX(request, bed.id), { message: "Ctrl+Shift+Z never reapplied the drag" }).toBe(130);
      await expect(undoButton).toBeEnabled();
      await expect(redoButton).toBeDisabled();

      // Undo again to get back to a redoable state...
      await page.keyboard.press("Control+z");
      await expect.poll(() => pollBedX(request, bed.id)).toBe(50);
      await expect(redoButton).toBeEnabled();

      // ...then make a genuinely NEW change instead of redoing - the old
      // redo entry (re-apply x=130) must be discarded, not still sitting
      // there waiting for a Ctrl+Shift+Z that would silently reapply a
      // stale, now-irrelevant position.
      await page.mouse.move(box.x + 80, box.y + 80);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y + 160, { steps: 10 }); // +80cm down instead
      await page.mouse.up();
      await expect.poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.y).toBe(130);
      await expect(redoButton).toBeDisabled();

      // Confirming Ctrl+Shift+Z now truly does nothing (no stale redo
      // silently reapplying).
      const beforeStaleRedo = await (await request.get(`/api/beds/${bed.id}`)).json();
      await page.keyboard.press("Control+Shift+z");
      await page.waitForTimeout(300);
      const afterStaleRedo = await (await request.get(`/api/beds/${bed.id}`)).json();
      expect(afterStaleRedo.border_geometry).toEqual(beforeStaleRedo.border_geometry);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("garden boundary resize: undo reverts it", async ({ page, request }) => {
    const gardenRes = await request.put("/api/garden", {
      data: { name: "E2E Undo Garden", border_geometry: rect(0, 0, 500, 300) },
    });
    expect(gardenRes.ok()).toBeTruthy();

    // The first-ever PUT /api/garden auto-creates a "Ground" bed matching
    // the entire boundary (app/api/routes/garden.py) - left uncleaned
    // (there's no DELETE /api/garden to reset the *garden* row itself
    // between runs, so this only auto-creates once, but the bed persists
    // across every later run of this spec) it would silently overlap and
    // block every other test in this file's own bed-drag assertions via
    // the "beds must not intersect" hard constraint - confirmed the hard
    // way: this cost a debugging pass before being caught here.
    const beds = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
    const groundBed = beds.find((b) => b.name === "Ground");
    if (groundBed) await request.delete(`/api/beds/${groundBed.id}?cascade=true`).catch(() => {});

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
      if (await startFromScratch.isVisible().catch(() => false)) await startFromScratch.click();
      await page.getByRole("tab", { name: "Garden" }).click();

      const box = await canvasBox(page);
      // Click the boundary to select it, then drag its right-middle resize
      // handle to grow it.
      await page.mouse.click(box.x + 250, box.y + 150);
      await page.waitForTimeout(150);
      await page.mouse.move(box.x + 500, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 600, box.y + 150, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => (await (await request.get("/api/garden")).json()).border_geometry.width, {
          message: "garden boundary resize never persisted",
        })
        .not.toBe(500);

      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => (await (await request.get("/api/garden")).json()).border_geometry.width, {
          message: "Ctrl+Z never reverted the garden boundary resize",
        })
        .toBe(500);
    } finally {
      // No DELETE /api/garden route - see other specs in this dir for the
      // same caveat. Clear via db-query after this file runs.
    }
  });

  test("planting move and equipment place/unplace: undo reverts both", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Undo Planting Bed", rect(200, 200, 300, 300));
    const slug = `e2e-undo-plant-${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: "E2E Undo Plant", botanical_name: "Testus e2eus" },
    });
    const plantingRes = await request.post("/api/plantings", {
      data: {
        bed_id: bed.id,
        plant_slug: slug,
        placement_type: "individual",
        geometry: rect(40, 40, 40, 40),
        planted_date: null,
        removed_date: null,
      },
    });
    const planting = await plantingRes.json();

    const equipmentRes = await request.post("/api/bed-equipment", {
      data: { bed_id: null, equipment_type: "trellis", geometry: null },
    });
    expect(equipmentRes.ok()).toBeTruthy();
    const equipment = await equipmentRes.json();

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      // --- Planting move ---
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);
      const box = await canvasBox(page);
      // Marker center: bed world (200,200) + local (60,60).
      await page.mouse.move(box.x + 260, box.y + 260);
      await page.mouse.down();
      await page.mouse.move(box.x + 360, box.y + 260, { steps: 10 }); // +100cm
      await page.mouse.up();

      await expect
        .poll(async () => (await (await request.get(`/api/plantings/${planting.id}`)).json()).geometry.x, {
          message: "planting drag never persisted",
        })
        .not.toBe(40);

      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => (await (await request.get(`/api/plantings/${planting.id}`)).json()).geometry.x, {
          message: "Ctrl+Z never reverted the planting move",
        })
        .toBe(40);

      // --- Equipment place, then undo ---
      await page.getByRole("tab", { name: "Equipment" }).click();
      await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
      await page.getByRole("combobox").selectOption(String(bed.id));

      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${equipment.id}`)).json()).bed_id, {
          message: "placing the equipment item never persisted",
        })
        .toBe(bed.id);

      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${equipment.id}`)).json()).bed_id, {
          message: "Ctrl+Z never reverted the equipment placement",
        })
        .toBeNull();

      // --- Redo brings the placement back ---
      await page.keyboard.press("Control+Shift+z");
      await expect
        .poll(async () => (await (await request.get(`/api/bed-equipment/${equipment.id}`)).json()).bed_id, {
          message: "Ctrl+Shift+Z never reapplied the equipment placement",
        })
        .toBe(bed.id);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/bed-equipment/${equipment.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
