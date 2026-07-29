import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #16 ("Fix inconsistent grid-snap application +
 * add object-edge alignment snapping") - `snapToGrid`/`findAlignmentSnap`
 * themselves already have solid Vitest coverage (`geometry.test.ts`), but
 * that's pure-function testing of the math; what's untested is whether
 * every drag-commit site the ticket lists (bed resize, polygon vertex/
 * whole-shape drag, planting drag, bed-to-bed alignment) actually *calls*
 * that math during a real gesture - exactly the "inconsistent application"
 * bug this ticket fixes, and exactly what a Vitest/jsdom test can't drive
 * (no real Konva pointer/Transformer system there).
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };
type Poly = { type: "polygon"; points: { x: number; y: number }[] };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect | Poly): Promise<{ id: number }> {
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

async function openBedsTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Beds" }).click();
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

test.describe("Grid-snap and bed-to-bed alignment snap (#16)", () => {
  test("dragging a bed by a non-grid-aligned amount lands it on the 10cm grid", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Grid Drag Bed", rect(100, 100, 80, 80));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      await page.mouse.move(box.x + 140, box.y + 140); // center
      await page.mouse.down();
      // +23cm - not a multiple of 10; snapToGrid(123) should land at 120.
      await page.mouse.move(box.x + 163, box.y + 140, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.x, {
          message: "dragged bed never snapped to the 10cm grid",
        })
        .toBe(120);
    } finally {
      // cascade=true: bed creation auto-generates a prepare_bed task
      // (#192), so a plain delete now 409s on that FK - see #204's own
      // root-cause finding. A bare delete here silently fails and leaks the
      // bed into the next run, where it overlaps the next freshly-created
      // bed at the same coordinates and falsely trips the "beds must not
      // overlap" hard constraint - not a real interaction regression.
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("resizing a bed by a non-grid-aligned amount snaps the result to the 10cm grid", async ({ page, request }) => {
    const bed = await createBed(request, "E2E Grid Resize Bed", rect(100, 100, 80, 80));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      await page.mouse.click(box.x + 140, box.y + 140); // select -> Transformer appears
      await page.waitForTimeout(150);

      // Right-middle resize handle at world (180, 140) - grow width by 23cm
      // (not a multiple of 10); snapToGrid(103) should land at 100.
      await page.mouse.move(box.x + 180, box.y + 140);
      await page.mouse.down();
      await page.mouse.move(box.x + 203, box.y + 140, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.width, {
          message: "resized bed's width never snapped to the 10cm grid",
        })
        .toBe(100);
    } finally {
      // cascade=true: bed creation auto-generates a prepare_bed task
      // (#192), so a plain delete now 409s on that FK - see #204's own
      // root-cause finding. A bare delete here silently fails and leaks the
      // bed into the next run, where it overlaps the next freshly-created
      // bed at the same coordinates and falsely trips the "beds must not
      // overlap" hard constraint - not a real interaction regression.
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("dragging a polygon bed's vertex by a non-grid-aligned amount snaps it to the 10cm grid", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Grid Polygon Bed", {
      type: "polygon",
      points: [
        { x: 700, y: 100 },
        { x: 800, y: 100 },
        { x: 800, y: 200 },
        { x: 700, y: 200 },
      ],
    });

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      // Select the polygon bed first - vertex handles only render once
      // selected.
      await page.mouse.click(box.x + 750, box.y + 150);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      // Drag vertex 0 (700,100) by (23,17) - neither a multiple of 10;
      // snapToGrid(723)=720, snapToGrid(117)=120.
      const vx = box.x + 700;
      const vy = box.y + 100;
      await page.mouse.move(vx, vy);
      await page.mouse.down();
      await page.mouse.move(vx + 23, vy + 17, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(
          async () => {
            const fetched = (await (await request.get(`/api/beds/${bed.id}`)).json()) as { border_geometry: Poly };
            return fetched.border_geometry.points[0];
          },
          { message: "dragged polygon vertex never snapped to the 10cm grid" },
        )
        .toEqual({ x: 720, y: 120 });
    } finally {
      // cascade=true: bed creation auto-generates a prepare_bed task
      // (#192), so a plain delete now 409s on that FK - see #204's own
      // root-cause finding. A bare delete here silently fails and leaks the
      // bed into the next run, where it overlaps the next freshly-created
      // bed at the same coordinates and falsely trips the "beds must not
      // overlap" hard constraint - not a real interaction regression.
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("dragging a planting marker by a non-grid-aligned amount snaps it to the 10cm grid", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Grid Planting Bed", rect(200, 200, 300, 300));
    const slug = `e2e-grid-snap-plant-${Date.now()}`;
    await request.post("/api/plants", {
      data: { slug, common_name: "E2E Grid Snap Plant", botanical_name: "Testus e2eus" },
    });
    const plantingRes = await request.post("/api/plantings", {
      data: {
        bed_id: bed.id,
        plant_slug: slug,
        placement_type: "individual",
        geometry: rect(40, 40, 40, 40), // bed-local
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
      // Marker center: bed world (200,200) + planting-local center
      // (40+20, 40+20) = (260, 260).
      await page.mouse.move(box.x + 260, box.y + 260);
      await page.mouse.down();
      // +23,+17 - neither a multiple of 10; snapToGrid(63)=60, snapToGrid(57)=60.
      await page.mouse.move(box.x + 283, box.y + 277, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(
          async () => {
            const fetched = (await (await request.get(`/api/plantings/${planting.id}`)).json()) as {
              geometry: Rect;
            };
            return { x: fetched.geometry.x, y: fetched.geometry.y };
          },
          { message: "dragged planting marker never snapped to the 10cm grid" },
        )
        .toEqual({ x: 60, y: 60 });
    } finally {
      await request.delete(`/api/plantings/${planting.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      // cascade=true: bed creation auto-generates a prepare_bed task
      // (#192), so a plain delete now 409s on that FK - see #204's own
      // root-cause finding. A bare delete here silently fails and leaks the
      // bed into the next run, where it overlaps the next freshly-created
      // bed at the same coordinates and falsely trips the "beds must not
      // overlap" hard constraint - not a real interaction regression.
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("dragging a bed close to another bed's edge snaps into exact alignment, overriding the plain grid snap", async ({
    page,
    request,
  }) => {
    // Bed A's right edge, dragged toward bed B's left edge (322, deliberately
    // not a grid multiple) - a grid-only snap would land bed A's right edge
    // at 320 (2cm short); the alignment snap (6px/cm threshold) should pull
    // it the rest of the way to touch exactly at 322.
    const bedA = await createBed(request, "E2E Align Snap A", rect(100, 100, 80, 80));
    const bedB = await createBed(request, "E2E Align Snap B", rect(322, 100, 80, 80));

    try {
      await openBedsTab(page);
      const box = await canvasBox(page);

      await page.mouse.move(box.x + 140, box.y + 140); // bed A's center
      await page.mouse.down();
      // +142cm right: raw target x = 100+142 = 242 (bed A's right edge at
      // 322, exactly bed B's left edge) - grid-snap alone would round this
      // to 240 (right edge 320), 2cm short; alignment snap should correct
      // it back to the exact touch position.
      await page.mouse.move(box.x + 282, box.y + 140, { steps: 15 });
      await page.mouse.up();

      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bedA.id}`)).json()).border_geometry.x, {
          message: "bed A never snapped into exact alignment with bed B's edge",
        })
        .toBe(242);
    } finally {
      // cascade=true - see this file's own earlier comment.
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
    }
  });
});
