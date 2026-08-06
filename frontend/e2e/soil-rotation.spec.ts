import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #229 ("Soil rotation: log an N-way rotation
 * event + provenance-aware warning tooltip"). No e2e spec existed for
 * `SoilRotationDialog.tsx` before this file - the implementer's own
 * outcome comment verified Part 1 (the dialog's own leg-list mechanics)
 * via an uncommitted Playwright run against the live backend, and verified
 * Part 2 (the inherited-conflict tooltip wording) only by reading
 * `rotation.py`'s source plus the backend's own pytest suite, not by
 * actually rendering the tooltip. This file covers both: the dialog's
 * leg-list/fresh-soil/close-the-loop mechanics directly, and - the part
 * with zero frontend-rendered coverage before this - a real end-to-end
 * inherited-conflict scenario (plant a family in bed A, log a rotation
 * moving A's soil to bed B, then confirm the rotation-warning tooltip on a
 * same-family placement in bed B says "soil moved here from {A}", not
 * implying B grew it directly).
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const WARNING_TRIANGLE_COLOR = { r: 217, g: 119, b: 6 }; // #d97706, PlantPlacementLayer.tsx's WARNING_TRIANGLE_COLOR

/** Same technique as `rotation-warning.spec.ts`'s own `regionContainsColor`
 * - composites every same-sized Konva layer canvas and scans for the
 * warning-triangle's own fixed color. The rotation check that decides
 * whether to draw this triangle is fire-and-forget (an API round trip after
 * the planting itself already exists) - polling for the triangle's actual
 * rendered color, rather than hovering immediately after the planting
 * appears, is what gives that check time to resolve before asserting on its
 * tooltip. */
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

async function openObjectsTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Objects" }).click();
}

async function openDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log soil rotation" }).click();
  await expect(page.getByRole("heading", { name: "Log soil rotation" })).toBeVisible();
}

test.describe("Soil rotation dialog mechanics (#229)", () => {
  test("a simple two-bed rotation persists one event with one transfer", async ({ page, request }) => {
    const stamp = Date.now();
    const bedA = await createBed(request, `E2E Rot A ${stamp}`, rect(40, 40, 100, 100));
    const bedB = await createBed(request, `E2E Rot B ${stamp}`, rect(200, 40, 100, 100));

    try {
      await openObjectsTab(page);
      await openDialog(page);

      await page.getByRole("combobox", { name: "Leg 1 source" }).selectOption(String(bedA.id));
      await page.getByRole("combobox", { name: "Leg 1 destination" }).selectOption(String(bedB.id));
      await expect(page.getByText(`E2E Rot A ${stamp}'s soil → E2E Rot B ${stamp}`)).toBeVisible();

      await page.getByRole("button", { name: "Log rotation", exact: true }).click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByText(`E2E Rot A ${stamp}'s soil → E2E Rot B ${stamp}`)).toBeVisible();
      await confirmDialog.getByRole("button", { name: "Log rotation" }).click();

      await expect(page.getByText("Soil rotation logged")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Log soil rotation" })).toHaveCount(0);

      const events = (await (await request.get("/api/soil-rotation-events")).json()) as {
        id: number;
        transfers: { from_bed_id: number | null; to_bed_id: number }[];
      }[];
      const created = [...events].reverse().find((e) => e.transfers.some((t) => t.to_bed_id === bedB.id && t.from_bed_id === bedA.id));
      expect(created, "no matching soil rotation event/transfer was ever persisted").toBeTruthy();
      expect(created!.transfers).toHaveLength(1);
    } finally {
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
    }
  });

  test("fresh/external soil (no source bed) submits with from_bed_id null", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Rot Fresh ${stamp}`, rect(40, 40, 100, 100));

    try {
      await openObjectsTab(page);
      await openDialog(page);

      await page.getByRole("combobox", { name: "Leg 1 source" }).selectOption("__fresh__");
      await page.getByRole("combobox", { name: "Leg 1 destination" }).selectOption(String(bed.id));
      await expect(page.getByText(`Fresh soil → E2E Rot Fresh ${stamp}`)).toBeVisible();

      await page.getByRole("button", { name: "Log rotation", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Log rotation" }).click();
      await expect(page.getByText("Soil rotation logged")).toBeVisible();

      const events = (await (await request.get("/api/soil-rotation-events")).json()) as {
        transfers: { from_bed_id: number | null; to_bed_id: number }[];
      }[];
      const created = [...events].reverse().find((e) => e.transfers.some((t) => t.to_bed_id === bed.id && t.from_bed_id === null));
      expect(created, "no fresh-soil (from_bed_id=null) transfer was ever persisted").toBeTruthy();
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("Add leg prefills the new leg's source from the previous leg's destination, and a used destination disappears from every other leg's own To options", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedA = await createBed(request, `E2E Rot MultiA ${stamp}`, rect(40, 40, 100, 100));
    const bedB = await createBed(request, `E2E Rot MultiB ${stamp}`, rect(200, 40, 100, 100));
    const bedC = await createBed(request, `E2E Rot MultiC ${stamp}`, rect(360, 40, 100, 100));

    try {
      await openObjectsTab(page);
      await openDialog(page);

      await page.getByRole("combobox", { name: "Leg 1 source" }).selectOption(String(bedA.id));
      await page.getByRole("combobox", { name: "Leg 1 destination" }).selectOption(String(bedB.id));
      await page.getByRole("button", { name: "Add leg" }).click();

      // Prefill: leg 2's own source starts already set to bed B (leg 1's
      // destination), not blank.
      await expect(page.getByRole("combobox", { name: "Leg 2 source" })).toHaveValue(String(bedB.id));

      // Bed B is already claimed as leg 1's destination - it must not
      // reappear as a selectable option in leg 2's own To list (self-
      // transfer/duplicate-destination prevented by construction, not a
      // validation error - see the dialog's own doc).
      const leg2To = page.getByRole("combobox", { name: "Leg 2 destination" });
      await expect(leg2To.locator(`option[value="${bedB.id}"]`)).toHaveCount(0);
      // Bed C is still free - must be selectable.
      await expect(leg2To.locator(`option[value="${bedC.id}"]`)).toHaveCount(1);

      await leg2To.selectOption(String(bedC.id));
      await expect(page.getByText(`E2E Rot MultiB ${stamp}'s soil → E2E Rot MultiC ${stamp}`)).toBeVisible();
    } finally {
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedC.id}?cascade=true`).catch(() => {});
    }
  });

  test("'Close the loop' appends a final leg back to the first bed and disappears once already closed; a 3-way cycle persists 3 transfers", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedA = await createBed(request, `E2E Rot LoopA ${stamp}`, rect(40, 40, 100, 100));
    const bedB = await createBed(request, `E2E Rot LoopB ${stamp}`, rect(200, 40, 100, 100));
    const bedC = await createBed(request, `E2E Rot LoopC ${stamp}`, rect(360, 40, 100, 100));

    try {
      await openObjectsTab(page);
      await openDialog(page);

      // Not eligible yet - only one leg, no full first-bed source set on
      // more than a single leg's own chain.
      await expect(page.getByRole("button", { name: /Close the loop/ })).toHaveCount(0);

      await page.getByRole("combobox", { name: "Leg 1 source" }).selectOption(String(bedA.id));
      await page.getByRole("combobox", { name: "Leg 1 destination" }).selectOption(String(bedB.id));
      await page.getByRole("button", { name: "Add leg" }).click();
      await page.getByRole("combobox", { name: "Leg 2 destination" }).selectOption(String(bedC.id));

      const closeLoopButton = page.getByRole("button", { name: `Close the loop back to E2E Rot LoopA ${stamp}` });
      await expect(closeLoopButton).toBeVisible();
      await closeLoopButton.click();

      // A 3rd leg appeared: C -> A.
      await expect(page.getByRole("combobox", { name: "Leg 3 source" })).toHaveValue(String(bedC.id));
      await expect(page.getByRole("combobox", { name: "Leg 3 destination" })).toHaveValue(String(bedA.id));
      // Now genuinely closed - the shortcut itself disappears (bed A is
      // already used as a destination, so `canCloseLoop`'s own "not already
      // closed" condition should now be false).
      await expect(page.getByRole("button", { name: /Close the loop/ })).toHaveCount(0);

      await page.getByRole("button", { name: "Log rotation", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Log rotation" }).click();
      await expect(page.getByText("Soil rotation logged")).toBeVisible();

      const events = (await (await request.get("/api/soil-rotation-events")).json()) as {
        transfers: { from_bed_id: number | null; to_bed_id: number }[];
      }[];
      const created = [...events]
        .reverse()
        .find((e) => e.transfers.length === 3 && e.transfers.some((t) => t.to_bed_id === bedA.id && t.from_bed_id === bedC.id));
      expect(created, "the 3-way closed cycle was never persisted with all 3 transfers").toBeTruthy();
    } finally {
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedC.id}?cascade=true`).catch(() => {});
    }
  });

  test("canceling the confirm dialog leaves the form dialog open with every field intact, and nothing is persisted", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedA = await createBed(request, `E2E Rot CancelA ${stamp}`, rect(40, 40, 100, 100));
    const bedB = await createBed(request, `E2E Rot CancelB ${stamp}`, rect(200, 40, 100, 100));

    try {
      await openObjectsTab(page);
      await openDialog(page);

      await page.getByRole("combobox", { name: "Leg 1 source" }).selectOption(String(bedA.id));
      await page.getByRole("combobox", { name: "Leg 1 destination" }).selectOption(String(bedB.id));
      await page.getByRole("textbox", { name: "Notes" }).fill("cancel-test notes");

      await page.getByRole("button", { name: "Log rotation", exact: true }).click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole("button", { name: "Cancel" }).click();

      await expect(confirmDialog).toHaveCount(0);
      // Form dialog still open with the same selections/notes, not reset.
      await expect(page.getByRole("heading", { name: "Log soil rotation" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Leg 1 source" })).toHaveValue(String(bedA.id));
      await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("cancel-test notes");

      const events = (await (await request.get("/api/soil-rotation-events")).json()) as {
        transfers: { from_bed_id: number | null; to_bed_id: number }[];
      }[];
      const leaked = events.some((e) => e.transfers.some((t) => t.to_bed_id === bedB.id && t.from_bed_id === bedA.id));
      expect(leaked, "canceling the confirm step must not have persisted anything").toBe(false);
    } finally {
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
    }
  });
});

test.describe("Provenance-aware rotation-warning tooltip (#229 Part 2)", () => {
  test("a same-family placement in a bed that inherited soil from another bed's recent planting names the real source bed, not itself", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedA = await createBed(request, `E2E Rot Inherit Source ${stamp}`, rect(40, 40, 200, 150));
    const bedB = await createBed(request, `E2E Rot Inherit Dest ${stamp}`, rect(300, 40, 400, 300));
    const tomatoSlug = `e2e-rot-inherit-tomato-${stamp}`;
    const pepperSlug = `e2e-rot-inherit-pepper-${stamp}`;
    const family = `E2E Inherit Nightshade Family ${stamp}`;
    await createPlant(request, tomatoSlug, `E2E Rot Inherit Tomato ${stamp}`, family, 40);
    await createPlant(request, pepperSlug, `E2E Rot Inherit Pepper ${stamp}`, family, 40);

    try {
      // Bed A grew the tomato today - well within the default lookback.
      await createExistingPlanting(request, bedA.id, tomatoSlug, rect(20, 20, 40, 40), todayIso());

      // Log a rotation moving bed A's soil into bed B, via the real
      // dialog - bed B now inherits bed A's soil-family-history.
      await openObjectsTab(page);
      await openDialog(page);
      await page.getByRole("combobox", { name: "Leg 1 source" }).selectOption(String(bedA.id));
      await page.getByRole("combobox", { name: "Leg 1 destination" }).selectOption(String(bedB.id));
      await page.getByRole("button", { name: "Log rotation", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Log rotation" }).click();
      await expect(page.getByText("Soil rotation logged")).toBeVisible();

      // Now place the same-family pepper in bed B (which has never itself
      // grown anything) - the conflict should be flagged as *inherited*
      // from bed A, named explicitly.
      await page.getByRole("tab", { name: "Plants" }).click();
      await armPlant(page, `E2E Rot Inherit Pepper ${stamp}`);

      const box = await canvasBox(page);
      // Bed B spans world (300,40)-(700,340) - click well inside it.
      const clickX = 500;
      const clickY = 200;
      await page.mouse.click(box.x + clickX, box.y + clickY);

      await expect
        .poll(async () => (await plantingsFor(request, bedB.id)).length, { message: "the new pepper planting in bed B never appeared", timeout: 5000 })
        .toBe(1);

      const triangleX = clickX + 20 * 0.7;
      const triangleY = clickY - 20 * 0.7;
      await expect
        .poll(
          async () => regionContainsColor(page, box.x + triangleX - 6, box.y + triangleY - 6, 12, 12, WARNING_TRIANGLE_COLOR),
          { message: "no warning-triangle color found at the new planting's flagged corner", timeout: 5000 },
        )
        .toBe(true);

      await page.mouse.move(box.x + triangleX, box.y + triangleY);
      await expect(page.getByText("Placement warning")).toBeVisible();
      await expect(
        page.getByText(
          `Rotation: same family as E2E Rot Inherit Tomato ${stamp} (planted ${todayIso()}) - soil moved here from E2E Rot Inherit Source ${stamp}`,
        ),
      ).toBeVisible();
    } finally {
      for (const p of [...(await plantingsFor(request, bedA.id)), ...(await plantingsFor(request, bedB.id))]) {
        await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      }
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/plants/${pepperSlug}`).catch(() => {});
      await request.delete(`/api/plants/${tomatoSlug}`).catch(() => {});
    }
  });
});
