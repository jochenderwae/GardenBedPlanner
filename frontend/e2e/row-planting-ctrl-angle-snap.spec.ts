import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #262 ("Row plantings alignment with ctrl
 * button") - `geometry.ts`'s `snapPointToAngle`/`ANGLE_SNAP_STEP_DEG` math
 * already has solid Vitest unit coverage (`geometry.test.ts`), but the
 * actual wiring this ticket added - `e.evt.ctrlKey` flowing from
 * `Layout.tsx`'s Stage mousemove through `PlantPlacementLayerHandle` into a
 * live row-placement drag, and reverting to free-angle when Ctrl is
 * released mid-drag - only exists at the component/interaction layer and
 * needs a real browser to prove out.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Point = { x: number; y: number };

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

async function armPlant(page: Page, commonName: string, modeLabel: "Row" | "Area"): Promise<void> {
  await page.getByRole("button", { name: "Pick a plant" }).click();
  await page.getByRole("button", { name: new RegExp(commonName) }).click();
  await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: commonName, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: modeLabel }).click();
}

async function plantingsFor(request: APIRequestContext, bedId: number): Promise<{ id: number; geometry: Rect }[]> {
  const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; bed_id: number; geometry: Rect }[];
  return plantings.filter((p) => p.bed_id === bedId);
}

async function waitForPlanting(request: APIRequestContext, bedId: number): Promise<{ id: number; geometry: Rect }> {
  await expect
    .poll(async () => (await plantingsFor(request, bedId)).length, { message: `no planting ever appeared for bed ${bedId}`, timeout: 5000 })
    .toBeGreaterThan(0);
  const matches = await plantingsFor(request, bedId);
  return matches[matches.length - 1];
}

test.describe("Ctrl angle-snap for row placement drags (#262)", () => {
  test("dragging a row without Ctrl held keeps the raw free angle", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Ctrl Snap Free Angle Bed", rect(200, 200, 400, 300));
    const slug = `e2e-ctrl-snap-free-${Date.now()}`;
    const commonName = `E2E Ctrl Snap Free ${Date.now()}`;
    await createPlant(request, slug, commonName, 20);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      // Bed-local (50,50)->(200,90): dx=150, dy=40 -> raw angle ~14.93deg,
      // not a clean multiple of 45.
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 400, y: box.y + 290 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.geometry.rotation).toBeGreaterThan(5);
      expect(planting.geometry.rotation).toBeLessThan(25);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("holding Ctrl during the drag snaps the row to exactly horizontal", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Ctrl Snap Horizontal Bed", rect(200, 200, 400, 300));
    const slug = `e2e-ctrl-snap-horiz-${Date.now()}`;
    const commonName = `E2E Ctrl Snap Horiz ${Date.now()}`;
    await createPlant(request, slug, commonName, 20);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      // Same not-quite-horizontal drag as the free-angle test above, but
      // now with Ctrl held throughout - should snap to exactly 0deg.
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 400, y: box.y + 290 };
      await page.keyboard.down("Control");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up("Control");

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.geometry.rotation).toBeCloseTo(0, 0);
      // Length should reflect the drag's own projected length along the
      // snapped 0deg ray (~150cm, the dx component), not the raw drag's
      // hypot distance (~155cm) - proves the endpoint tracks the cursor's
      // actual projected position, not just a rotation-only override.
      expect(planting.geometry.width).toBeGreaterThan(140);
      expect(planting.geometry.width).toBeLessThan(156);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("holding Ctrl during a roughly-vertical drag snaps to exactly vertical", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Ctrl Snap Vertical Bed", rect(200, 200, 400, 300));
    const slug = `e2e-ctrl-snap-vert-${Date.now()}`;
    const commonName = `E2E Ctrl Snap Vert ${Date.now()}`;
    await createPlant(request, slug, commonName, 20);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      // dx=10, dy=150 -> raw angle ~86.19deg, near-vertical but not exact.
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const end: Point = { x: box.x + 260, y: box.y + 400 };
      await page.keyboard.down("Control");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up("Control");

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.geometry.rotation).toBeCloseTo(90, 0);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("releasing Ctrl mid-drag reverts to free-angle tracking for the final commit", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Ctrl Snap Mid-Release Bed", rect(200, 200, 400, 300));
    const slug = `e2e-ctrl-snap-release-${Date.now()}`;
    const commonName = `E2E Ctrl Snap Release ${Date.now()}`;
    await createPlant(request, slug, commonName, 20);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, commonName, "Row");

      const box = await canvasBox(page);
      const start: Point = { x: box.x + 250, y: box.y + 250 };
      const mid: Point = { x: box.x + 325, y: box.y + 270 };
      const end: Point = { x: box.x + 400, y: box.y + 290 };

      // Start the drag with Ctrl held (would snap to 0deg if it stayed held
      // through mouseup)...
      await page.keyboard.down("Control");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(mid.x, mid.y, { steps: 5 });
      // ...then release Ctrl before mouseup - the final commit should use
      // the raw free angle again, matching the no-Ctrl test's ~14.93deg,
      // not exactly 0deg.
      await page.keyboard.up("Control");
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();

      const planting = await waitForPlanting(request, bed.id);
      expect(planting.geometry.rotation).toBeGreaterThan(5);
      expect(planting.geometry.rotation).toBeLessThan(25);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
