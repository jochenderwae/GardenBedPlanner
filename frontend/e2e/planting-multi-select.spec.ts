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
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
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
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
