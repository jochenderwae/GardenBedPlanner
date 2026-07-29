import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #26 ("Succession/rotation warnings by crop
 * family") - the backend `GET /api/beds/{bed_id}/rotation-check` endpoint
 * already has solid pytest coverage; what's untested is the frontend UI
 * wiring the implementer's own outcome comment explicitly could not verify
 * (no browser-automation tool available at implementation time): does
 * placing a same-family crop shortly after another actually surface the
 * amber `WarningTriangle` (`PlantPlacementLayer.tsx`) with the right
 * hover-tooltip content, and does placing a *different*-family crop
 * correctly show nothing.
 *
 * Uses the app's DEFAULT_VIEWPORT (no "Fit view" click - see
 * `bed-label-overlap.spec.ts`'s own doc for why this sidesteps all the
 * viewport/fitViewport-replica pitfalls the handle-scaling specs ran into)
 * so a click at a known screen point lands at the identical world
 * coordinate, letting the resulting Point-mode planting's center - and
 * from it, the triangle's own render position - be predicted exactly
 * (`PlantPlacementLayer.tsx`'s individual-marker branch: triangle at
 * `(centerX + radius*0.7, centerY - radius*0.7)`, `radius = max(4, spread_cm/2)`)
 * without needing any bed-local/world coordinate translation math, since a
 * click at world (cx, cy) centers the new marker exactly there.
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

async function createPlant(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  family: string,
  spreadCm: number,
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", family, spread_cm: spreadCm },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createExistingPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  geometry: Rect,
  plantedDate: string,
): Promise<void> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry, planted_date: plantedDate },
  });
  expect(res.ok(), `failed to create existing planting: ${res.status()} ${await res.text()}`).toBeTruthy();
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

/** Arms a plant via the "Pick a plant" popover - same pattern
 * `plant-placement-modes.spec.ts` uses (Point mode is the default, no mode
 * radio click needed). */
async function armPlant(page: Page, commonName: string): Promise<void> {
  await page.getByRole("button", { name: "Pick a plant" }).click();
  await page.getByRole("button", { name: new RegExp(commonName) }).click();
  await expect(page.getByPlaceholder(/search plants/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: commonName, exact: true })).toBeVisible();
}

async function plantingsFor(request: APIRequestContext, bedId: number): Promise<{ id: number }[]> {
  const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; bed_id: number }[];
  return plantings.filter((p) => p.bed_id === bedId);
}

const WARNING_TRIANGLE_COLOR = { r: 217, g: 119, b: 6 }; // #d97706, PlantPlacementLayer.tsx's WARNING_TRIANGLE_COLOR

/** Scans a rectangular CSS-pixel region for an opaque pixel close to
 * `target` RGB, compositing every same-sized Konva layer canvas first -
 * same technique as `bed-label-overlap.spec.ts`'s `regionContainsColor`
 * (including its alpha-channel fix - see that spec's own doc for the
 * transparent-background false-positive it caught). */
async function regionContainsColor(
  page: Page,
  cssX: number,
  cssY: number,
  width: number,
  height: number,
  target: { r: number; g: number; b: number },
  tolerance = 30,
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("Crop-rotation warning triangle (#26)", () => {
  test("placing a same-family crop shortly after another shows the warning triangle, with the family name on hover", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, "E2E Rotation Bed", rect(200, 200, 400, 300));
    const tomatoSlug = `e2e-rot-tomato-${stamp}`;
    const pepperSlug = `e2e-rot-pepper-${stamp}`;
    const family = `E2E Nightshade Family ${stamp}`;
    await createPlant(request, tomatoSlug, `E2E Rotation Tomato ${stamp}`, family, 40);
    await createPlant(request, pepperSlug, `E2E Rotation Pepper ${stamp}`, family, 40);

    try {
      // An existing planting of the tomato, planted today - well within
      // the default 730-day lookback window.
      await createExistingPlanting(request, bed.id, tomatoSlug, rect(20, 20, 40, 40), todayIso());

      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, `E2E Rotation Pepper ${stamp}`);

      const box = await canvasBox(page);
      // Click well clear of the existing tomato planting (bed-local
      // (20,20)-(60,60)) - world (400,400) is bed-local (200,200).
      const clickX = 400;
      const clickY = 400;
      await page.mouse.click(box.x + clickX, box.y + clickY);

      await expect
        .poll(async () => (await plantingsFor(request, bed.id)).length, { message: "the new pepper planting never appeared", timeout: 5000 })
        .toBe(2);

      // Triangle at (centerX + radius*0.7, centerY - radius*0.7),
      // radius = max(4, spread_cm/2) = max(4, 20) = 20.
      const triangleX = clickX + 20 * 0.7;
      const triangleY = clickY - 20 * 0.7;

      await expect
        .poll(
          async () => regionContainsColor(page, box.x + triangleX - 6, box.y + triangleY - 6, 12, 12, WARNING_TRIANGLE_COLOR),
          { message: "no warning-triangle color found at the new planting's flagged corner", timeout: 5000 },
        )
        .toBe(true);

      // Hover it and confirm the tooltip identifies the conflicting
      // planting, not just "same plant" (the ticket's own step 4
      // requirement). Copy per #174's design spec (generalized the title
      // from #26's original "Rotation warning: <family>" to a reason-
      // agnostic "Placement warning" title + a "Rotation: ..." reason
      // line, since a marker can now accumulate several simultaneous
      // reasons, not just rotation).
      await page.mouse.move(box.x + triangleX, box.y + triangleY);
      await expect(page.getByText("Placement warning")).toBeVisible();
      await expect(page.getByText(`Rotation: same family as E2E Rotation Tomato ${stamp} (planted ${todayIso()})`)).toBeVisible();
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${pepperSlug}`).catch(() => {});
      await request.delete(`/api/plants/${tomatoSlug}`).catch(() => {});
    }
  });

  test("placing a different-family crop after another shows no warning triangle", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, "E2E Rotation Bed 2", rect(200, 200, 400, 300));
    const tomatoSlug = `e2e-rot2-tomato-${stamp}`;
    const beanSlug = `e2e-rot2-bean-${stamp}`;
    await createPlant(request, tomatoSlug, `E2E Rotation2 Tomato ${stamp}`, `E2E Nightshade Family2 ${stamp}`, 40);
    await createPlant(request, beanSlug, `E2E Rotation2 Bean ${stamp}`, `E2E Legume Family2 ${stamp}`, 40);

    try {
      await createExistingPlanting(request, bed.id, tomatoSlug, rect(20, 20, 40, 40), todayIso());

      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, `E2E Rotation2 Bean ${stamp}`);

      const box = await canvasBox(page);
      const clickX = 400;
      const clickY = 400;
      await page.mouse.click(box.x + clickX, box.y + clickY);

      await expect
        .poll(async () => (await plantingsFor(request, bed.id)).length, { message: "the new bean planting never appeared", timeout: 5000 })
        .toBe(2);

      // Give the fire-and-forget rotation check a moment to have resolved
      // (it correctly resolves to has_warning=false here, but there's no
      // positive DOM signal to poll for the *absence* of - just wait long
      // enough that a false positive would have shown up by now).
      await page.waitForTimeout(500);

      const triangleX = clickX + 20 * 0.7;
      const triangleY = clickY - 20 * 0.7;
      const hasTriangle = await regionContainsColor(page, box.x + triangleX - 6, box.y + triangleY - 6, 12, 12, WARNING_TRIANGLE_COLOR);
      expect(hasTriangle, "a warning triangle appeared for a different-family planting - should only fire on a family conflict").toBe(false);

      await page.mouse.move(box.x + triangleX, box.y + triangleY);
      await page.waitForTimeout(200);
      await expect(page.locator(".pointer-events-none.absolute.z-10")).toHaveCount(0);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${beanSlug}`).catch(() => {});
      await request.delete(`/api/plants/${tomatoSlug}`).catch(() => {});
    }
  });
});
