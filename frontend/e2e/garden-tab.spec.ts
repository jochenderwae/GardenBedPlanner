import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #89 ("Add a dedicated 'Garden' tab to the
 * canvas editor, reorder tabs, cascading lock") - all 4 of the ticket's
 * own "How to test" steps are about default landing state, tab ordering,
 * interactive-vs-locked behavior per tab, and drawing/editing a polygon
 * boundary - none of which a typecheck can observe, and the ticket has no
 * implementer outcome comment to work from either way.
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

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

test.describe("Dedicated Garden tab, ordering, and cascading lock (#89)", () => {
  test("lands on the Garden tab by default, with tabs in Garden -> Beds -> Plants -> Equipment order", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Garden Tab Bed", rect(100, 100, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(4);
      await expect(tabs).toHaveText(["Garden", "Beds", "Plants", "Equipment"]);

      // Default landing tab is Garden, not Beds.
      await expect(page.getByRole("tab", { name: "Garden" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab", { name: "Beds" })).toHaveAttribute("aria-selected", "false");

      // Always reachable regardless of what else is going on - clicking
      // any other tab and back still works.
      await page.getByRole("tab", { name: "Plants" }).click();
      await expect(page.getByRole("tab", { name: "Garden" })).toHaveAttribute("aria-selected", "false");
      await page.getByRole("tab", { name: "Garden" }).click();
      await expect(page.getByRole("tab", { name: "Garden" })).toHaveAttribute("aria-selected", "true");
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("cascading lock: a bed doesn't respond to a drag gesture while on the Plants or Equipment tab", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Cascading Lock Bed", rect(100, 100, 80, 80));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);

      const box = await canvasBox(page);

      for (const tabName of ["Plants", "Equipment"]) {
        await page.getByRole("tab", { name: tabName }).click();
        await page.waitForTimeout(150);

        await page.mouse.move(box.x + 140, box.y + 140); // bed center
        await page.mouse.down();
        await page.mouse.move(box.x + 240, box.y + 140, { steps: 10 }); // attempt +100cm
        await page.mouse.up();
        await page.waitForTimeout(300);

        const fetched = (await (await request.get(`/api/beds/${bed.id}`)).json()) as { border_geometry: Rect };
        expect(fetched.border_geometry.x, `bed moved while on the ${tabName} tab - should be locked`).toBe(100);
        // No BedPanel either - a bed can't even be selected outside its
        // own tab.
        await expect(page.getByRole("heading", { name: "Edit bed" })).toHaveCount(0);
      }
    } finally {
      await request.delete(`/api/beds/${bed.id}`).catch(() => {});
    }
  });

  test("a polygon garden boundary can be drawn/edited (vertex-dragged) from the Garden tab", async ({ page, request }) => {
    const gardenPolygon: Poly = {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
    };
    const gardenRes = await request.put("/api/garden", { data: { name: "E2E Garden Tab Polygon", border_geometry: gardenPolygon } });
    expect(gardenRes.ok()).toBeTruthy();
    const beds = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
    const groundBed = beds.find((b) => b.name === "Ground");
    if (groundBed) await request.delete(`/api/beds/${groundBed.id}?cascade=true`).catch(() => {});

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      // Default tab is already "Garden" - no click needed, but be explicit
      // in case a stray earlier interaction changed it.
      await page.getByRole("tab", { name: "Garden" }).click();

      const box = await canvasBox(page);
      // Drag vertex 0 (0,0) by (30,20) - both multiples of the 10cm snap
      // grid.
      const vx = box.x;
      const vy = box.y;
      await page.mouse.move(vx, vy);
      await page.mouse.down();
      await page.mouse.move(vx + 30, vy + 20, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(
          async () => {
            const garden = await (await request.get("/api/garden")).json();
            return garden.border_geometry.points[0];
          },
          { message: "dragging the polygon garden boundary's vertex never persisted" },
        )
        .toEqual({ x: 30, y: 20 });
    } finally {
      // Bed cleanup already handled above (the auto-created "Ground" bed
      // was removed before this test's own interactions began) - nothing
      // further to clean up here. The Garden row itself has no DELETE
      // route (see other specs in this dir for the same caveat) - clear
      // garden_test's garden table manually after running this file.
    }
  });
});
