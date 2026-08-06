import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #233 (Timeline: group crop rows by plant, not by
 * individual Planting). `timelineData.test.ts` already covers the pure
 * grouping logic (`timelineRows`) at the unit level - this covers the
 * rendering/interaction consequence that unit test can't reach: two
 * individually-placed plantings of the same species in the same bed collapse
 * into one Gantt row with an "N plantings" subtitle, its detail panel lists
 * every planting instead of a single Planted/Removed pair, and the same
 * species placed in a *different* bed stays a fully separate row (per-bed
 * grouping, not garden-wide - the ticket's own settled design decision).
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number; name: string }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createPlanting(
  request: APIRequestContext,
  bedId: number,
  plantSlug: string,
  plantedDate: string,
): Promise<{ id: number }> {
  const res = await request.post("/api/plantings", {
    data: { bed_id: bedId, plant_slug: plantSlug, placement_type: "individual", geometry: rect(0, 0, 20, 20), planted_date: plantedDate },
  });
  expect(res.ok(), `failed to create planting: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function deleteBed(request: APIRequestContext, bedId: number): Promise<void> {
  // Same #215 workaround timeline-view.spec.ts already uses - null out this
  // bed's own actions' depends_on_action_id before deleting, so a bed with
  // a self-referential sow->prepare_bed dependency doesn't 500 on cascade.
  const actionsRes = await request.get("/api/actions").catch(() => null);
  if (actionsRes?.ok()) {
    const actions = (await actionsRes.json()) as { id: number; bed_id: number | null }[];
    for (const action of actions.filter((a) => a.bed_id === bedId)) {
      await request.patch(`/api/actions/${action.id}`, { data: { depends_on_action_id: null } }).catch(() => {});
    }
    for (const action of actions.filter((a) => a.bed_id === bedId)) {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  }
  await request.delete(`/api/beds/${bedId}?cascade=true`).catch(() => {});
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

function detailPanelContent(page: Page) {
  return page.locator('[data-slot="card-content"]');
}

const thisYear = new Date().getFullYear();

test.describe("Timeline: per-(bed, plant) grouping (#233)", () => {
  test("two plantings of the same species in the same bed collapse into one row with a plantings count; a third planting of the same species in a different bed stays separate", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-233-crop-${stamp}`;
    const commonName = `E2E Grouped Crop ${stamp}`;
    const bedA = await createBed(request, `E2E 233 Bed A ${stamp}`, rect(20, 20, 60, 60));
    const bedB = await createBed(request, `E2E 233 Bed B ${stamp}`, rect(120, 20, 60, 60));
    await createPlant(request, slug, commonName);

    const p1 = await createPlanting(request, bedA.id, slug, `${thisYear}-01-05`);
    const p2 = await createPlanting(request, bedA.id, slug, `${thisYear}-02-10`);
    const p3 = await createPlanting(request, bedB.id, slug, `${thisYear}-03-01`);

    try {
      await page.goto("/timeline");
      await dismissOnboardingIfPresent(page);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

      // Exactly two rows for this plant: one grouped row for Bed A (2
      // plantings), one ungrouped row for Bed B (1 planting) - not three
      // separate rows, and not one garden-wide row.
      const rowButtons = page.getByRole("button").filter({ hasText: commonName });
      await expect(rowButtons).toHaveCount(2);

      const groupedRow = page.getByRole("button", { name: new RegExp(`${commonName}.*${bedA.name}.*2 plantings`) });
      await expect(groupedRow).toBeVisible();
      await expect(page.getByText(`${bedA.name} · 2 plantings`)).toBeVisible();

      const ungroupedRow = page.getByRole("button").filter({ hasText: commonName }).filter({ hasText: bedB.name });
      await expect(ungroupedRow).toBeVisible();
      // The single-planting row reads exactly as it did pre-#233 - no
      // "N plantings" suffix polluting the ungrouped case.
      await expect(ungroupedRow.getByText(/plantings/)).toHaveCount(0);

      // Detail panel for the grouped row lists both plantings' own dates,
      // not a single Planted/Removed pair.
      await groupedRow.click();
      await expect(detailPanelContent(page).getByText("Plantings (2)")).toBeVisible();
      await expect(detailPanelContent(page).getByText(`Planted ${thisYear}-01-05`)).toBeVisible();
      await expect(detailPanelContent(page).getByText(`Planted ${thisYear}-02-10`)).toBeVisible();

      // Detail panel for the ungrouped row still renders the plain
      // single-planting shape.
      await ungroupedRow.click();
      await expect(detailPanelContent(page).getByText("Plantings (")).toHaveCount(0);
      await expect(detailPanelContent(page).getByText(`${thisYear}-03-01`)).toBeVisible();
    } finally {
      for (const p of [p1, p2, p3]) {
        await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      }
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await deleteBed(request, bedA.id);
      await deleteBed(request, bedB.id);
    }
  });
});
