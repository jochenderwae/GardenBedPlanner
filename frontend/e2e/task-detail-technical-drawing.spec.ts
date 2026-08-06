import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #246 ("Technical drawing in task") - the
 * implementer's own outcome comment only verified this with a throwaway,
 * uncommitted Playwright screenshot script. No committed spec exercised
 * `TaskDetail.tsx`'s new inline `TechnicalDrawingCanvas` embed before this
 * file: `technical-drawing.spec.ts` covers the standalone
 * `/layout/beds/:bedId/technical-drawing` page (which now just wraps the
 * same shared component), but not the embed itself, and specifically not
 * the ticket's own headline claim - that `TaskDetail` mounts on both the
 * desktop and mobile route trees at `/tasks/:id`, so reusing the read-only
 * canvas covers the mobile answer too without a separate mobile rendering.
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

async function createAction(request: APIRequestContext, overrides: Record<string, unknown>): Promise<{ id: number }> {
  const res = await request.post("/api/actions", {
    data: { action_type: "prepare_bed", status: "pending", due_date_start: null, due_date_end: null, ...overrides },
  });
  expect(res.ok(), `failed to create action: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** Same "composite every Konva layer canvas, is there any real (non-
 * grayscale) color anywhere" technique `technical-drawing.spec.ts` and
 * `garden-timeline.spec.ts` already use - confirms the embedded drawing
 * actually rendered plant markers, not just an empty canvas element. */
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

async function cleanUp(
  request: APIRequestContext,
  opts: { actionId?: number; bedId?: number; plantSlug?: string },
): Promise<void> {
  if (opts.actionId != null) await request.delete(`/api/actions/${opts.actionId}`).catch(() => {});
  if (opts.bedId != null) {
    const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; bed_id: number }[];
    for (const p of plantings.filter((p) => p.bed_id === opts.bedId)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
  }
  if (opts.plantSlug) await request.delete(`/api/plants/${opts.plantSlug}`).catch(() => {});
  if (opts.bedId != null) await request.delete(`/api/beds/${opts.bedId}?cascade=true`).catch(() => {});
}

test.describe("Technical drawing embedded inline in TaskDetail (#246)", () => {
  test("desktop width: a task with a bed renders the drawing inline, no link out to a separate page", async ({ page, request }) => {
    const stamp = Date.now();
    const bedName = `E2E TaskDrawing Bed ${stamp}`;
    const slug = `e2e-taskdrawing-plant-${stamp}`;
    const bed = await createBed(request, bedName, rect(40, 40, 200, 150));
    await createPlant(request, slug, `E2E TaskDrawing Plant ${stamp}`, 20);
    await createIndividualPlanting(request, bed.id, slug, rect(30, 65, 20, 20));
    const action = await createAction(request, { bed_id: bed.id });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByText(bedName)).toBeVisible();

      // Inline, not a link out - #246's whole point.
      await expect(page.getByRole("link", { name: "View technical drawing" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Technical drawing" })).toHaveCount(0);

      const canvas = page.locator("canvas").first();
      await canvas.waitFor();
      await expect.poll(() => canvasHasAnySaturatedColor(page), { message: "no plant marker rendered in the embedded drawing" }).toBe(true);

      // Still on the task detail page - embedding didn't navigate away.
      await expect(page).toHaveURL(new RegExp(`/tasks/${action.id}$`));
    } finally {
      await cleanUp(request, { actionId: action.id, bedId: bed.id, plantSlug: slug });
    }
  });

  test("mobile width (390px): the same TaskDetail route embeds the same read-only drawing, not a squeezed editor", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedName = `E2E TaskDrawing Mobile Bed ${stamp}`;
    const slug = `e2e-taskdrawing-mobile-plant-${stamp}`;
    const bed = await createBed(request, bedName, rect(40, 40, 200, 150));
    await createPlant(request, slug, `E2E TaskDrawing Mobile Plant ${stamp}`, 20);
    await createIndividualPlanting(request, bed.id, slug, rect(30, 65, 20, 20));
    const action = await createAction(request, { bed_id: bed.id });

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByText(bedName)).toBeVisible();

      const canvas = page.locator("canvas").first();
      await canvas.waitFor();
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      // Fits within the phone viewport - not clipped off-screen or forcing
      // horizontal scroll (the "squeezed desktop editor" failure mode
      // CLAUDE.md's mobile convention warns about, which this component's
      // own doc explicitly argues doesn't apply here since it's read-only).
      expect(box!.width).toBeLessThanOrEqual(390);
      await expect.poll(() => canvasHasAnySaturatedColor(page), { message: "no plant marker rendered in the embedded drawing at phone width" }).toBe(true);
    } finally {
      await cleanUp(request, { actionId: action.id, bedId: bed.id, plantSlug: slug });
    }
  });

  test("a task with no bed_id shows no Bed row and no canvas at all", async ({ page, request }) => {
    const action = await createAction(request, { bed_id: null, notes: "no bed on this one" });

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByText("no bed on this one")).toBeVisible(); // page did load the real action
      await expect(page.getByText("Bed", { exact: true })).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
    } finally {
      await cleanUp(request, { actionId: action.id });
    }
  });

  test("a task whose bed was deleted shows a graceful error, not a crash", async ({ page, request }) => {
    // A bed with no dependents can be hard-deleted (no cascade needed);
    // cascade_delete_bed_dependents (beds.py) explicitly deletes any
    // Action still referencing the bed as part of a *cascade* delete, so
    // the only way to leave an Action pointing at a now-missing bed is a
    // plain (non-cascade) delete of a bed with zero remaining dependents -
    // which requires deleting this task's own bed_id reference first, then
    // deleting the bed, then restoring the action's bed_id via a raw PATCH
    // (bypassing the FK check the create/patch routes would otherwise
    // enforce is not possible from the API - so this simulates the same
    // observable symptom instead: bedQuery resolving to a 404 for an id
    // that doesn't exist, by pointing a fresh action at an id one past the
    // highest one ever allocated).
    const probe = await createBed(request, `E2E TaskDrawing Probe ${Date.now()}`, rect(0, 0, 50, 50));
    const nonexistentBedId = probe.id + 100000;
    await request.delete(`/api/beds/${probe.id}?cascade=true`);

    // Confirm the id is genuinely unused before relying on it.
    const check = await request.get(`/api/beds/${nonexistentBedId}`);
    expect(check.status(), "test setup assumption failed: id unexpectedly in use").toBe(404);

    const actionRes = await request.post("/api/actions", {
      data: { action_type: "prepare_bed", status: "pending", bed_id: nonexistentBedId },
    });
    // If the backend actually enforces the bed_id FK on create (409), this
    // scenario isn't reachable via the API at all - which is itself a fine
    // outcome (stronger data integrity than the frontend needs to defend
    // against). Only proceed to the frontend assertion when it wasn't
    // enforced.
    test.skip(!actionRes.ok(), "backend rejects an action with a nonexistent bed_id (409) - stale bed_id isn't reachable via the API");
    const action = (await actionRes.json()) as { id: number };

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByText(`Bed #${nonexistentBedId}`)).toBeVisible(); // fallback label while/if the bed fetch fails
      await expect(page.getByText(/Failed to load this bed's technical drawing|No bed found for this id/)).toBeVisible();
      await expect(page.locator("canvas")).toHaveCount(0);
    } finally {
      await cleanUp(request, { actionId: action.id });
    }
  });
});
