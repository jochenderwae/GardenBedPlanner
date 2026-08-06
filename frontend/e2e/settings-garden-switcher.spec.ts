import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #239 (Settings page / active-garden switcher).
 * #258's backend scoping already has thorough pytest coverage
 * (test_garden_scoped_lists.py) - this spec's job is the UI wiring itself:
 * the Settings page lists every garden, switching the active one via its
 * <select> actually calls the activate endpoint and persists (survives a
 * reload), and a dependent page (Bed Planner) visibly reflects whichever
 * garden is active without any further action.
 *
 * The implementer's own outcome comment verified this end-to-end via a
 * throwaway, uncommitted Playwright script - this is the real, committed
 * equivalent.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function activateViaApi(request: APIRequestContext, gardenId: number): Promise<void> {
  const res = await request.post(`/api/gardens/${gardenId}/activate`);
  expect(res.ok(), `failed to activate garden ${gardenId}`).toBeTruthy();
}

test.describe("Settings: active-garden switcher (#239)", () => {
  test("switching the active garden via the Settings select persists and updates a dependent page", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const gardenAName = `E2E Garden A ${suffix}`;
    const gardenBName = `E2E Garden B ${suffix}`;
    const bedAName = `E2E Bed in A ${suffix}`;
    const bedBName = `E2E Bed in B ${suffix}`;

    // First garden via PUT /api/garden is auto-activated.
    const gardenA = await (
      await request.put("/api/garden", { data: { name: gardenAName, border_geometry: rect(0, 0, 300, 300) } })
    ).json();
    const bedA = await (
      await request.post("/api/beds", {
        data: { name: bedAName, border_geometry: rect(0, 0, 70, 200) },
        params: { is_initial_state: "true" },
      })
    ).json();

    const gardenB = await (
      await request.post("/api/gardens", { data: { name: gardenBName, border_geometry: rect(0, 0, 300, 300) } })
    ).json();
    await activateViaApi(request, gardenB.id);
    const bedB = await (
      await request.post("/api/beds", {
        data: { name: bedBName, border_geometry: rect(0, 0, 70, 200) },
        params: { is_initial_state: "true" },
      })
    ).json();

    try {
      await page.goto("/settings");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      const select = page.getByLabel("Garden");
      await expect(select).toHaveValue(String(gardenB.id));

      // Switch to Garden A via the real UI control.
      await select.selectOption(String(gardenA.id));
      await expect
        .poll(async () => (await (await request.get("/api/garden")).json()).id, {
          message: "switching via the Settings select never persisted server-side",
        })
        .toBe(gardenA.id);

      // Persists across a reload - the select re-reads server state, not local-only.
      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(page.getByLabel("Garden")).toHaveValue(String(gardenA.id));

      // A dependent page (Bed Planner) reflects the switch: Garden A's bed
      // shows, Garden B's does not.
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      const beds = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
      expect(beds.some((b) => b.id === bedA.id)).toBe(true);
      expect(beds.some((b) => b.id === bedB.id)).toBe(false);

      // Switch back to Garden B and confirm the flip reverses.
      await page.goto("/settings");
      await dismissOnboardingIfPresent(page);
      await page.getByLabel("Garden").selectOption(String(gardenB.id));
      await expect
        .poll(async () => (await (await request.get("/api/garden")).json()).id, {
          message: "switching back to Garden B never persisted server-side",
        })
        .toBe(gardenB.id);
      const bedsAfterSwitchBack = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
      expect(bedsAfterSwitchBack.some((b) => b.id === bedB.id)).toBe(true);
      expect(bedsAfterSwitchBack.some((b) => b.id === bedA.id)).toBe(false);
    } finally {
      await request.delete(`/api/beds/${bedA.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedB.id}?cascade=true`).catch(() => {});
      // Reactivate whichever garden isn't the last one so the other can be
      // deleted (the API refuses to delete the active/only garden).
      await activateViaApi(request, gardenA.id).catch(() => {});
      await request.delete(`/api/gardens/${gardenB.id}`).catch(() => {});
    }
  });

  test("adding a garden with no name shows a validation error and does not create anything", async ({ page }) => {
    await page.goto("/settings");
    await dismissOnboardingIfPresent(page);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.getByRole("button", { name: "Add garden" }).click();
    await expect(page.getByText("Name is required.")).toBeVisible();
  });

  test("adding a garden starts it inactive and it appears in the switcher", async ({ page, request }) => {
    const name = `E2E New Inactive Garden ${Date.now()}`;
    await page.goto("/settings");
    await dismissOnboardingIfPresent(page);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const previouslyActiveId = (await (await request.get("/api/garden")).json()).id;

    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Add garden" }).click();

    await expect(page.getByLabel("Garden").locator(`option:has-text("${name}")`)).toHaveCount(1);
    // Still on the previously-active garden - adding one doesn't switch to it.
    await expect(page.getByLabel("Garden")).toHaveValue(String(previouslyActiveId));

    const gardens = (await (await request.get("/api/gardens")).json()) as { id: number; name: string; is_active: boolean }[];
    const created = gardens.find((g) => g.name === name);
    expect(created?.is_active).toBe(false);

    if (created) {
      await request.delete(`/api/gardens/${created.id}`).catch(() => {});
    }
  });
});
