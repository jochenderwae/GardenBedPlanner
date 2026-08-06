import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #223 ("Compost & fertilization logging UI -
 * mobile Logging tab + compost bin status") - the implementer's own outcome
 * comment verified logging one compost entry and one compost-bin fill-state
 * edit + reload manually. Not explicitly verified: a *fertilizer* log
 * correctly distinguishing its own `type` (the ticket's own step 2), the
 * last-turned-date field specifically, or step 4 (a bed with no linked
 * compost bin shows no bin-status UI at all) - those are this spec's main
 * net-new coverage. Mobile-only per the ticket's own settled Platform note.
 *
 * Every field is looked up via `fieldControl` (a `<label>` containing the
 * given text, then its own nested control), not `getByLabel` directly - a
 * `<label>` wrapping a `<select>` computes its accessible name by folding in
 * the select's own selected-option text (same accname "embedded control"
 * behavior `garden-plan.spec.ts` and `new-task-recurrence.spec.ts` both hit
 * independently), so `getByLabel("Bed")` never actually equals "Bed" alone -
 * it's "Bed" + whatever's currently selected. `MobileLogging.tsx`'s own
 * "Bed to mark as a compost bin" picker has no `<label>` wrapper at all
 * (aria-label directly on the `<select>`), so scoping to `<label>` elements
 * specifically also sidesteps that separate collision risk.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

function fieldControl(scope: Locator | Page, labelText: string): Locator {
  return scope.locator("label", { hasText: labelText }).locator("select, input, textarea");
}

/** `CompostBinRow`'s own top-level wrapper div - matched by its exact class
 * signature (`flex flex-col gap-2 border-t pt-3`), unique to that component
 * on this page, then filtered to the one row for `bedName`. */
function binRow(page: Page, bedName: string): Locator {
  return page.locator("div.flex.flex-col.gap-2.border-t.pt-3").filter({ hasText: bedName });
}

async function createBed(request: APIRequestContext, name: string): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: rect(200, 200, 100, 100) } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function gotoMobileLogging(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/logging");
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole("heading", { name: "Logging" })).toBeVisible();
}

async function logsForBed(request: APIRequestContext, bedId: number) {
  const all = (await (await request.get("/api/compost-fertilization-logs")).json()) as {
    id: number;
    bed_id: number;
    type: string;
    product: string;
    amount: string;
  }[];
  return all.filter((l) => l.bed_id === bedId);
}

test.describe("Compost & fertilization logging (mobile Logging tab, #223)", () => {
  test("logging a compost application persists with type='compost'", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Compost Log Bed ${stamp}`);

    try {
      await gotoMobileLogging(page);

      await fieldControl(page, "Bed").selectOption(String(bed.id));
      // Type defaults to Compost already - no need to change it.
      await page.getByPlaceholder("e.g. homemade compost").fill("Homemade leaf mold");
      await page.getByPlaceholder("e.g. 2 wheelbarrows").fill("2 wheelbarrows");
      await page.getByRole("button", { name: "Save log" }).click();

      await expect
        .poll(async () => (await logsForBed(request, bed.id)).length, {
          message: "compost log was never created",
        })
        .toBe(1);
      const log = (await logsForBed(request, bed.id))[0];
      expect(log.type).toBe("compost");
      expect(log.product).toBe("Homemade leaf mold");
      expect(log.amount).toBe("2 wheelbarrows");

      // RecentLogsList's own type label - scoped by its class signature,
      // since a bare exact-text match also resolves the Type <select>'s
      // own "Compost" <option>.
      await expect(page.locator("span.font-medium", { hasText: "Compost" })).toBeVisible();
      await expect(page.getByText(/Homemade leaf mold/)).toBeVisible();
    } finally {
      for (const l of await logsForBed(request, bed.id)) await request.delete(`/api/compost-fertilization-logs/${l.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("logging a fertilizer application distinguishes type='fertilizer' from a compost log", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Fertilizer Log Bed ${stamp}`);

    try {
      await gotoMobileLogging(page);

      await fieldControl(page, "Bed").selectOption(String(bed.id));
      await fieldControl(page, "Type").selectOption("fertilizer");
      await page.getByPlaceholder("e.g. homemade compost").fill("Fish emulsion");
      await page.getByPlaceholder("e.g. 2 wheelbarrows").fill("500ml diluted");
      await page.getByRole("button", { name: "Save log" }).click();

      await expect
        .poll(async () => (await logsForBed(request, bed.id)).length, {
          message: "fertilizer log was never created",
        })
        .toBe(1);
      const log = (await logsForBed(request, bed.id))[0];
      expect(log.type).toBe("fertilizer");
      expect(log.product).toBe("Fish emulsion");

      await expect(page.locator("span.font-medium", { hasText: "Fertilizer" })).toBeVisible();
      await expect(page.getByText(/Fish emulsion/)).toBeVisible();
    } finally {
      for (const l of await logsForBed(request, bed.id)) await request.delete(`/api/compost-fertilization-logs/${l.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("marking a bed as a compost bin, editing its fill state and last-turned date, persists after reload", async ({ page, request }) => {
    const stamp = Date.now();
    const bedName = `E2E Compost Bin Bed ${stamp}`;
    const bed = await createBed(request, bedName);

    try {
      await gotoMobileLogging(page);

      // --- Mark the bed as a compost bin via the picker (no <label>
      // wrapper - aria-label directly on the <select>, unique on this
      // page). ---
      await page.getByLabel("Bed to mark as a compost bin").selectOption(String(bed.id));
      await page.getByRole("button", { name: "Add" }).click();

      const row = binRow(page, bedName);
      await expect(row).toBeVisible();

      // --- Edit fill state, last-turned date, and notes ---
      await fieldControl(row, "Fill state").selectOption("filling");
      await fieldControl(row, "Last turned").fill("2026-07-15");
      await fieldControl(row, "Notes").fill("Turned after adding kitchen scraps");
      await fieldControl(row, "Notes").blur();

      await expect
        .poll(
          async () => {
            const bins = (await (await request.get("/api/compost-bins")).json()) as {
              bed_id: number;
              fill_state: string;
              last_turned_date: string | null;
              notes: string;
            }[];
            return bins.find((b) => b.bed_id === bed.id)?.fill_state;
          },
          { message: "fill state edit never persisted" },
        )
        .toBe("filling");
      const bins = (await (await request.get("/api/compost-bins")).json()) as {
        bed_id: number;
        fill_state: string;
        last_turned_date: string | null;
        notes: string;
      }[];
      const bin = bins.find((b) => b.bed_id === bed.id)!;
      expect(bin.last_turned_date).toBe("2026-07-15");
      expect(bin.notes).toBe("Turned after adding kitchen scraps");

      // --- Reload and confirm all three fields are still there ---
      await page.reload();
      await dismissOnboardingIfPresent(page);
      const rowAfterReload = binRow(page, bedName);
      await expect(rowAfterReload).toBeVisible();
      await expect(fieldControl(rowAfterReload, "Fill state")).toHaveValue("filling");
      await expect(fieldControl(rowAfterReload, "Last turned")).toHaveValue("2026-07-15");
      await expect(fieldControl(rowAfterReload, "Notes")).toHaveValue("Turned after adding kitchen scraps");
    } finally {
      const bins = (await (await request.get("/api/compost-bins")).json()) as { id: number; bed_id: number }[];
      for (const b of bins.filter((bn) => bn.bed_id === bed.id)) await request.delete(`/api/compost-bins/${b.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a bed with no linked compost bin shows no bin-status UI - only the plain compost/fertilization log form applies", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedName = `E2E No Bin Bed ${stamp}`;
    const bed = await createBed(request, bedName);

    try {
      await gotoMobileLogging(page);

      // The bed is a normal option in the compost/fertilization log form's
      // own bed picker...
      await expect(fieldControl(page, "Bed").locator("option", { hasText: bedName })).toHaveCount(1);

      // ...and available to be *marked* as a compost bin (it isn't one
      // yet)...
      await expect(page.getByLabel("Bed to mark as a compost bin").locator("option", { hasText: bedName })).toHaveCount(1);

      // ...but shows no bin-status row of its own (fill state/last-turned/
      // estimated-maturity fields) anywhere on the page - those only exist
      // per actual CompostBin row.
      await expect(binRow(page, bedName)).toHaveCount(0);
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
