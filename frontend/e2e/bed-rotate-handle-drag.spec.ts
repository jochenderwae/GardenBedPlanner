import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #71 ("Verify/improve the bed-rotation
 * interaction in the canvas editor") - the rotate-*drag-gesture*
 * reliability half specifically (distinct from `bed-transformer-handle-
 * scaling.spec.ts`'s own coverage of the handle's on-screen *size*).
 *
 * This ticket's own history found the rotate handle's drag gesture
 * intermittently failed to register at all (same root-cause class #204
 * tracked for plain bed drag/resize/keyboard-nudge - "the gesture doesn't
 * fire, not a wrong-but-computed value"), verified only via uncommitted
 * throwaway scripts each time rather than real, repeatable coverage. This
 * closes that gap: a real spec dragging the actual Transformer rotate
 * handle (not a hand-rolled substitute), repeated several times in one run
 * to catch exactly the kind of intermittent non-registration #204's own
 * investigation found.
 *
 * Uses the app's DEFAULT_VIEWPORT (no "Fit view" click) - same reasoning
 * `bed-label-overlap.spec.ts`/`bed-canvas-drag-pan.spec.ts` document: world
 * coordinates map directly onto canvas-local pixels (scale=1, no pan) at
 * page load, letting the rotate handle's exact screen position be computed
 * directly from `BedNode.tsx`'s own `TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX`
 * (50px above the bounding box's top-center) instead of replicating
 * `fitViewport`'s zoom/pan math the way the handle-scaling spec has to.
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

const ROTATE_ANCHOR_OFFSET_PX = 50; // BedNode.tsx's TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX

test.describe("Bed Transformer rotate-handle drag (#71)", () => {
  test("dragging the rotate handle persists a real rotation change, repeated 5x in one run", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Rotate Handle Bed", rect(100, 100, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();
      const box = await canvasBox(page);

      const handleX = box.x + 140; // bounding-box top-center x (unrotated)
      const handleY = box.y + 100 - ROTATE_ANCHOR_OFFSET_PX; // 50px above the top edge

      async function currentRotation(): Promise<number> {
        const fetched = await (await request.get(`/api/beds/${bed.id}`)).json();
        return fetched.border_geometry.rotation as number;
      }

      for (let attempt = 1; attempt <= 5; attempt++) {
        // Re-select fresh each attempt (rather than dragging repeatedly off
        // one already-rotated Transformer) - after a real rotation the
        // handle's own on-screen position moves with the shape, so reusing
        // a fixed handleX/handleY for attempt 2+ would be testing a
        // different, no-longer-matching position rather than genuinely
        // repeating the same gesture. Resetting to 0° between attempts via
        // the API and reselecting keeps every attempt an apples-to-apples
        // repeat of the exact same drag.
        await page.mouse.click(box.x + 140, box.y + 140); // bed center: (100+40, 100+40)
        await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

        await page.mouse.move(handleX, handleY);
        await page.mouse.down();
        // Drag sideways - well clear of straight-up, so the resulting angle
        // is unambiguously non-zero.
        await page.mouse.move(handleX + 60, handleY + 20, { steps: 10 });
        await page.mouse.up();

        await expect
          .poll(currentRotation, {
            message: `attempt ${attempt}: rotate-handle drag never persisted a rotation change`,
            timeout: 5000,
          })
          .not.toBe(0);

        // Reset to 0° for the next attempt - a plain PATCH, then reload so
        // the canvas/Transformer picks up the reverted geometry before the
        // next drag (this reset itself isn't what's under test).
        const resetRes = await request.patch(`/api/beds/${bed.id}`, { data: { border_geometry: rect(100, 100, 80, 80) } });
        expect(resetRes.ok(), `attempt ${attempt}: failed to reset rotation between attempts`).toBeTruthy();
        await page.reload();
        await page.locator("canvas").first().waitFor();
        await dismissOnboardingIfPresent(page);
        await page.getByRole("tab", { name: "Beds" }).click();
      }
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
