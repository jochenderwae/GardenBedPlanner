import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #174 ("Planting warnings rendered as a warning
 * triangle") - the actual new scope beyond #26's already-shipped rotation
 * triangle (see `rotation-warning.spec.ts`, whose stale "Rotation warning:
 * <family>" tooltip-copy assertions were fixed alongside this file since
 * #174 generalized that copy to a reason-agnostic "Placement warning"
 * title): antagonist/good-companion placement-check results, the new
 * emerald `CompanionCheckmark` icon, and the arm-time *speculative* check
 * (flags an already-placed neighbor the moment a candidate plant is armed,
 * before any click) that #26's rotation-only mechanism never had. The
 * implementer's own outcome comment explicitly left this unverified (no
 * browser-automation tool available at implementation time; no new tests
 * added, "left to the tester role").
 *
 * Uses the app's DEFAULT_VIEWPORT (no "Fit view" click), same reasoning
 * `rotation-warning.spec.ts` documents, so a click at a known screen point
 * lands at a predictable world coordinate.
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

async function createCompanion(
  request: APIRequestContext,
  slug: string,
  companionSlug: string,
  relationship: "good" | "bad",
  mechanism: string,
): Promise<void> {
  const res = await request.post(`/api/plants/${slug}/companions`, {
    data: { plant_slug: slug, companion_plant_slug: companionSlug, relationship, mechanism },
  });
  expect(res.ok(), `failed to create companion: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createExistingPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  geometry: Rect,
): Promise<void> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry, planted_date: null },
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
 * `rotation-warning.spec.ts`/`plant-placement-modes.spec.ts` use. */
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

const WARNING_TRIANGLE_COLOR = { r: 217, g: 119, b: 6 }; // #d97706
const COMPANION_CHECKMARK_COLOR = { r: 5, g: 150, b: 105 }; // #059669

/** Scans a rectangular CSS-pixel region for an opaque pixel close to
 * `target` RGB, compositing every same-sized Konva layer canvas first -
 * same technique `rotation-warning.spec.ts`/`bed-label-overlap.spec.ts` use. */
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

// Bed at world (200,200)-(500,500), centroid (350,350) - the arm-time
// speculative check (per #174's design spec) approximates the not-yet-
// positioned candidate's location as the bed's own centroid, so the
// existing planting below is placed *exactly there* to guarantee a match
// regardless of that approximation.
const BED_RECT = rect(200, 200, 300, 300);
const EXISTING_LOCAL = rect(130, 130, 40, 40); // world center (350, 350)
const MARKER_RADIUS = 20; // max(4, spread_cm/2) for spread_cm=40
const ANCHOR_DX = MARKER_RADIUS * 0.7;
const ANCHOR_DY = MARKER_RADIUS * 0.7;

test.describe("Companion antagonist/good-companion placement warnings (#174)", () => {
  test("arming a bad-companion candidate flags an already-placed antagonist neighbor with a warning triangle before any placement happens", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Companion Bed ${stamp}`, BED_RECT);
    const existingSlug = `e2e-comp-existing-${stamp}`;
    const candidateSlug = `e2e-comp-bad-candidate-${stamp}`;
    const existingName = `E2E Companion Marigold ${stamp}`;
    const candidateName = `E2E Companion Antagonist ${stamp}`;
    await createPlant(request, existingSlug, existingName, 40);
    await createPlant(request, candidateSlug, candidateName, 40);
    await createCompanion(request, candidateSlug, existingSlug, "bad", "root competition");

    try {
      await createExistingPlanting(request, bed.id, existingSlug, EXISTING_LOCAL);

      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, candidateName);

      const box = await canvasBox(page);
      const anchorX = 350 + ANCHOR_DX;
      const anchorY = 350 - ANCHOR_DY;

      // No click happened yet - this is the arm-time speculative check
      // flagging the already-placed neighbor purely from arming, per the
      // ticket's own step 1.
      await expect
        .poll(
          async () => regionContainsColor(page, box.x + anchorX - 6, box.y + anchorY - 6, 12, 12, WARNING_TRIANGLE_COLOR),
          { message: "no warning triangle appeared on the existing planting after arming a bad-companion candidate", timeout: 5000 },
        )
        .toBe(true);

      await page.mouse.move(box.x + anchorX, box.y + anchorY);
      await expect(page.getByText("Placement warning")).toBeVisible();
      await expect(page.getByText(new RegExp(`Antagonist: inhibits ${candidateName}`))).toBeVisible();

      // Disarming clears the speculative state - the triangle goes away
      // again without anything having actually been placed.
      await page.keyboard.press("Escape");
      await expect
        .poll(
          async () => regionContainsColor(page, box.x + anchorX - 6, box.y + anchorY - 6, 12, 12, WARNING_TRIANGLE_COLOR),
          { message: "warning triangle never cleared after disarming the candidate", timeout: 5000 },
        )
        .toBe(false);
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${candidateSlug}`).catch(() => {});
      await request.delete(`/api/plants/${existingSlug}`).catch(() => {});
    }
  });

  test("arming a good-companion candidate flags an already-placed companion neighbor with a checkmark, not a triangle", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Companion Good Bed ${stamp}`, BED_RECT);
    const existingSlug = `e2e-comp-good-existing-${stamp}`;
    const candidateSlug = `e2e-comp-good-candidate-${stamp}`;
    const existingName = `E2E Companion Basil ${stamp}`;
    const candidateName = `E2E Companion Friend ${stamp}`;
    await createPlant(request, existingSlug, existingName, 40);
    await createPlant(request, candidateSlug, candidateName, 40);
    await createCompanion(request, candidateSlug, existingSlug, "good", "deters aphids");

    try {
      await createExistingPlanting(request, bed.id, existingSlug, EXISTING_LOCAL);

      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, candidateName);

      const box = await canvasBox(page);
      const anchorX = 350 + ANCHOR_DX;
      const anchorY = 350 - ANCHOR_DY;

      await expect
        .poll(
          async () => regionContainsColor(page, box.x + anchorX - 6, box.y + anchorY - 6, 12, 12, COMPANION_CHECKMARK_COLOR),
          { message: "no checkmark appeared on the existing planting after arming a good-companion candidate", timeout: 5000 },
        )
        .toBe(true);
      // Warning always wins over checkmark on the same marker (per the
      // design spec) - confirm the triangle color is genuinely absent, not
      // just untested.
      const hasTriangle = await regionContainsColor(page, box.x + anchorX - 6, box.y + anchorY - 6, 12, 12, WARNING_TRIANGLE_COLOR);
      expect(hasTriangle, "a warning triangle appeared for a pure good-companion match - should only ever be the checkmark").toBe(false);

      await page.mouse.move(box.x + anchorX, box.y + anchorY);
      await expect(page.getByText("Good companion")).toBeVisible();
      await expect(page.getByText(new RegExp(`Pairs well with ${candidateName}`))).toBeVisible();
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${candidateSlug}`).catch(() => {});
      await request.delete(`/api/plants/${existingSlug}`).catch(() => {});
    }
  });

  test("placing an antagonist plant near an existing companion shows a warning triangle on the new marker itself, no popup", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Companion Commit Bed ${stamp}`, BED_RECT);
    const existingSlug = `e2e-comp-commit-existing-${stamp}`;
    const candidateSlug = `e2e-comp-commit-candidate-${stamp}`;
    const existingName = `E2E Companion Commit Neighbor ${stamp}`;
    const candidateName = `E2E Companion Commit Bad ${stamp}`;
    await createPlant(request, existingSlug, existingName, 40);
    await createPlant(request, candidateSlug, candidateName, 40);
    await createCompanion(request, candidateSlug, existingSlug, "bad", "allelopathic");

    try {
      await createExistingPlanting(request, bed.id, existingSlug, EXISTING_LOCAL);

      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, candidateName);

      const box = await canvasBox(page);
      // Click 40cm from the existing planting's own center (350,350) -
      // well within the backend's 150cm neighbor-distance threshold.
      const clickX = 390;
      const clickY = 350;
      await page.mouse.click(box.x + clickX, box.y + clickY);

      await expect
        .poll(async () => (await plantingsFor(request, bed.id)).length, { message: "the new candidate planting never appeared", timeout: 5000 })
        .toBe(2);

      const anchorX = clickX + ANCHOR_DX;
      const anchorY = clickY - ANCHOR_DY;
      await expect
        .poll(
          async () => regionContainsColor(page, box.x + anchorX - 6, box.y + anchorY - 6, 12, 12, WARNING_TRIANGLE_COLOR),
          { message: "no warning triangle appeared on the newly-committed antagonist planting", timeout: 5000 },
        )
        .toBe(true);

      // No popup/dialog interrupted the placement itself - the antagonist
      // marker committed cleanly (this is the whole point of #174 - inline
      // icons instead of a blocking popup).
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      await page.mouse.move(box.x + anchorX, box.y + anchorY);
      await expect(page.getByText("Placement warning")).toBeVisible();
      await expect(page.getByText(new RegExp(`Antagonist: inhibits ${existingName}`))).toBeVisible();
    } finally {
      for (const p of await plantingsFor(request, bed.id)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${candidateSlug}`).catch(() => {});
      await request.delete(`/api/plants/${existingSlug}`).catch(() => {});
    }
  });
});
