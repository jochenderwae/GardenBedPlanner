import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #17 ("Keyboard shortcuts: arrow-key nudge,
 * Delete, Escape-to-deselect") - the ticket's own outcome comment says
 * "No browser-automation available in this environment, so interactive
 * verification stops at [build/lint/test] level" for all 5 of its own
 * "How to test" steps. None of arrow-key nudging, Delete-triggering-the-
 * real-confirm-dialog, or Escape-clearing-selection/armed-state can be
 * exercised by Vitest/jsdom (no real keyboard-event-to-Konva-canvas
 * wiring there) - this is a genuine gap only a real browser closes.
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

test.describe("Keyboard shortcuts in the canvas editor (#17)", () => {
  test("arrow key nudges the selected bed by 1cm; Shift+arrow nudges by 10cm", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Nudge Bed", rect(200, 200, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 240, box.y + 240); // bed center
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      await page.keyboard.press("ArrowRight");
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.x, {
          message: "plain ArrowRight never nudged the bed by 1cm",
        })
        .toBe(201);

      await page.keyboard.press("Shift+ArrowRight");
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.x, {
          message: "Shift+ArrowRight never nudged the bed by 10cm",
        })
        .toBe(211);

      await page.keyboard.press("ArrowDown");
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.y, {
          message: "plain ArrowDown never nudged the bed by 1cm",
        })
        .toBe(201);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("nudging a bed into another bed stops it at contact instead of overlapping", async ({ page, request }) => {
    // Right edge at 280; bedB's left edge at exactly 290 - a 10cm gap the
    // nudge below (10x ArrowRight, 1cm each) exactly closes without
    // overlapping (touching edges don't count as overlap - see
    // geometry.test.ts's own "treats merely-touching edges as not
    // overlapping" case).
    const bedA = await createBed(request, "E2E Nudge Blocked A", rect(200, 200, 80, 80));
    const bedB = await createBed(request, "E2E Nudge Blocked B", rect(290, 200, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 240, box.y + 240); // bed A's center
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
      await expect(page.getByRole("textbox").first()).toHaveValue("E2E Nudge Blocked A");

      // 10 nudges closes the exact 10cm gap; 5 more attempt to push it
      // straight through bed B - each of those must silently no-op.
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("ArrowRight");
      }
      await page.waitForTimeout(500); // let any (incorrect) trailing PATCH land before asserting

      const finalA = (await (await request.get(`/api/beds/${bedA.id}`)).json()).border_geometry as Rect;
      expect(finalA.x, "bed A must stop exactly where it touches bed B, not overlap it").toBe(210);
    } finally {
      await request.delete(`/api/beds/${bedA.id}`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}`).catch(() => {});
    }
  });

  test("Delete opens the real confirm dialog for a selected planting, and confirming actually removes it", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Delete Key Bed", rect(200, 200, 300, 300));
    const slug = `e2e-delete-key-plant-${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: "E2E Delete Key Plant", botanical_name: "Testus e2eus" },
    });
    const plantingRes = await request.post("/api/plantings", {
      data: {
        bed_id: bed.id,
        plant_slug: slug,
        placement_type: "individual",
        geometry: rect(230, 230, 40, 40),
        planted_date: null,
        removed_date: null,
      },
    });
    const planting = await plantingRes.json();

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await page.waitForTimeout(200);

      const box = await canvasBox(page);
      // Planting markers render inside a per-bed Konva Group offset by the
      // bed's own world position (PlantPlacementLayer.tsx), so a planting's
      // `geometry.x/y` is bed-local, not world/garden-space - screen center
      // = bed world (200,200) + planting-local center (230+20, 230+20) =
      // (450, 450).
      await page.mouse.click(box.x + 450, box.y + 450);
      await expect(page.getByRole("heading", { name: "E2E Delete Key Plant" })).toBeVisible();

      await page.keyboard.press("Delete");
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByRole("heading", { name: /Remove E2E Delete Key Plant\?/ })).toBeVisible();

      await confirmDialog.getByRole("button", { name: "Remove planting" }).click();

      await expect.poll(async () => (await request.get(`/api/plantings/${planting.id}`)).status()).toBe(404);
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("Escape clears an armed plant without placing or deleting anything", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Escape Arm Bed", rect(200, 200, 200, 200));
    const slug = `e2e-escape-arm-plant-${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: "E2E Escape Arm Plant", botanical_name: "Testus e2eus" },
    });

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();

      await page.getByRole("button", { name: "Pick a plant" }).click();
      await page.getByRole("button", { name: /E2E Escape Arm Plant/ }).click();
      // Armed - the toolbar button now shows the plant's name instead of
      // "Pick a plant".
      await expect(page.getByRole("button", { name: "E2E Escape Arm Plant" })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Pick a plant" })).toBeVisible();

      const plantings = await (await request.get("/api/plantings")).json();
      expect(plantings.filter((p: { bed_id: number }) => p.bed_id === bed.id)).toHaveLength(0);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("Escape clears the current bed selection", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Escape Select Bed", rect(200, 200, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();

      const box = await canvasBox(page);
      await page.mouse.click(box.x + 240, box.y + 240);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
