import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #72 ("Warn before a rectangle<->polygon shape
 * switch discards points"). `frontend/e2e/toggle-group-primitives.spec.ts`
 * (#143) already exercises the confirm/cancel mechanics of this exact
 * dialog in depth (steps 2-5 of this ticket's own "how to test"), starting
 * from a rectangle-derived 4-point polygon. This adds the one thing that
 * doesn't cover: starting from a bed with a genuinely irregular polygon (5
 * points, not the 4-corner shape the toggle itself would produce), and
 * verifying the post-confirm rectangle is the *correct* bounding box of
 * every one of those points - not just that a dialog appeared and
 * something happened.
 */

type Point = { x: number; y: number };
type PolygonGeom = { type: "polygon"; points: Point[] };

async function createPolygonBed(request: APIRequestContext, name: string, points: Point[]): Promise<{ id: number }> {
  const geometry: PolygonGeom = { type: "polygon", points };
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

test.describe("Shape-switch discard warning with an irregular polygon (#72)", () => {
  test("confirming the collapse of a 5-point irregular polygon produces the exact bounding box of all its points", async ({
    page,
    request,
  }) => {
    // An irregular pentagon, deliberately not a simple rectangle-derived
    // 4-corner shape - min/max across all 5 points: x in [50,250], y in
    // [40,220].
    const points: Point[] = [
      { x: 100, y: 40 },
      { x: 250, y: 80 },
      { x: 220, y: 220 },
      { x: 80, y: 200 },
      { x: 50, y: 120 },
    ];
    const bed = await createPolygonBed(request, "E2E Irregular Polygon Bed", points);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Objects" }).click();

      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      // Click somewhere clearly inside the pentagon (its rough centroid).
      await page.mouse.click(box.x + 140, box.y + 130);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      const shapeGroup = page.getByRole("radiogroup", { name: "Shape type" });
      const rectangleOption = shapeGroup.getByRole("radio", { name: "Rectangle" });
      const polygonOption = shapeGroup.getByRole("radio", { name: "Polygon" });
      await expect(polygonOption).toHaveAttribute("aria-checked", "true");

      await rectangleOption.click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(
        confirmDialog.getByText(/replaces the polygon with its bounding box/i),
      ).toBeVisible();

      // Cancel first - the polygon's own points must survive untouched.
      await confirmDialog.getByRole("button", { name: "No - keep polygon" }).click();
      await expect(confirmDialog).not.toBeVisible();
      const afterCancel = await (await request.get(`/api/beds/${bed.id}`)).json();
      expect(afterCancel.border_geometry.type).toBe("polygon");
      expect(afterCancel.border_geometry.points).toHaveLength(5);

      // Now actually confirm - the resulting rectangle must be exactly the
      // bounding box of all 5 original points, not e.g. just the first 4.
      await rectangleOption.click();
      await page.getByRole("button", { name: "Yes - delete points" }).click();

      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).border_geometry.type, {
          message: "confirming the shape switch never persisted as a rectangle",
        })
        .toBe("rectangle");

      const final = await (await request.get(`/api/beds/${bed.id}`)).json();
      expect(final.border_geometry).toMatchObject({
        type: "rectangle",
        x: 50,
        y: 40,
        width: 200, // 250 - 50
        height: 180, // 220 - 40
      });
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
