import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #68 ("Bed rotation should be relative to the
 * garden's own orientation, not an independent absolute angle") - the
 * ticket has no implementer outcome comment, but `geometry.ts`'s
 * `rotationRelativeToGarden`/`rotationFromGardenRelative` and their wiring
 * into `BedPanel.tsx`'s Rotation field are both present in the codebase.
 * The pure math already has solid Vitest coverage (`geometry.test.ts`) -
 * what's untested is the *integration*: does the real Rotation input
 * actually display/persist through this transform, and does changing the
 * garden's own orientation update the *displayed* relative value without
 * silently changing the bed's actual stored rotation (the ticket's own
 * "How to test" step 4's explicit non-goal).
 *
 * Same Garden-row cleanup caveat as bed-garden-boundary-clamp.spec.ts /
 * compass-widget.spec.ts (no `DELETE /api/garden` route exists).
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number, rotation = 0): Rect {
  return { type: "rectangle", x, y, width, height, rotation };
}

async function putGarden(request: APIRequestContext, orientationDeg: number): Promise<void> {
  const res = await request.put("/api/garden", {
    data: {
      name: "E2E Bed Rotation Garden",
      border_geometry: rect(0, 0, 1000, 1000),
      orientation_deg: orientationDeg,
    },
  });
  expect(res.ok(), `failed to PUT garden: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function deleteAutoCreatedGroundBed(request: APIRequestContext): Promise<void> {
  const beds = await (await request.get("/api/beds")).json();
  const ground = (beds as { id: number; name: string }[]).find((b) => b.name === "Ground");
  if (ground) await request.delete(`/api/beds/${ground.id}?cascade=true`).catch(() => {});
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

async function openBedPanel(page: Page, bedName: string): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Beds" }).click();
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  // The bed sits at world (400,400)-(500,500) - click its center. Rotation
  // doesn't move the shape's own bounding-box center for a Konva Rect
  // (rotates around its own x/y origin point, not its visual center, but
  // at a 100x100 size the origin-anchored rotation keeps the shape's own
  // (x,y) corner fixed and the click target - center of the *unrotated*
  // footprint - lands close enough for a reliable click across the
  // rotations this spec uses).
  await page.mouse.click(box.x + 450, box.y + 450);
  await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
  await expect(page.getByRole("textbox").first()).toHaveValue(bedName);
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

test.describe("Bed rotation relative to garden orientation (#68)", () => {
  test("Rotation field displays garden-relative, persists as absolute, and updates display (not storage) when the garden reorients", async ({
    page,
    request,
  }) => {
    await putGarden(request, 30);
    await deleteAutoCreatedGroundBed(request);
    const bed = await createBed(request, "E2E Rotation Bed", rect(400, 400, 100, 100, 100));

    try {
      // Step 2: Rotation field reads garden-relative (100 absolute - 30
      // garden orientation = 70), not the raw absolute value.
      await openBedPanel(page, "E2E Rotation Bed");
      const rotationInput = page.getByRole("spinbutton").nth(2);
      await expect(rotationInput).toHaveValue("70");

      // Step 3: entering a new garden-relative value persists the correct
      // absolute rotation (45 relative + 30 garden orientation = 75).
      await rotationInput.fill("45");
      await rotationInput.blur();
      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.rotation, {
          message: "new garden-relative rotation never persisted as the correct absolute value",
        })
        .toBe(75);

      // Step 4: reorienting the garden updates the *displayed* relative
      // value without touching the bed's own stored absolute rotation.
      await putGarden(request, 90);
      await openBedPanel(page, "E2E Rotation Bed"); // fresh navigation re-fetches the garden
      const rotationInputAfterReorient = page.getByRole("spinbutton").nth(2);
      // 75 absolute - 90 new garden orientation = -15 -> normalized to 345.
      await expect(rotationInputAfterReorient).toHaveValue(String(normalizeDeg(75 - 90)));

      const afterReorient = await (await request.get(`/api/beds/${bed.id}`)).json();
      expect(afterReorient.border_geometry.rotation).toBe(75); // unchanged by the garden reorientation itself
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });
});
