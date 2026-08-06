import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #242 (Objects tab: bed/compost-bin/decoration
 * creation buttons + compost bin panel + equipment Quick add) - the
 * implementer's own outcome comment verified this only via Playwright
 * against the local dev server, not committed. Covers the ticket's core new
 * workflows: the Objects tab (renamed from "Beds") shows all three creation
 * triggers, "Add compost bin" creates a linked Bed+CompostBin pair whose
 * BedPanel section renders, "Add decoration" creates a canvas object that
 * selects into its own DecorationPanel (not BedPanel) and deletes cleanly,
 * and the Equipment tab's "Quick add" creates-and-places a garden-bound
 * equipment item in one click.
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

async function gotoLayout(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
}

test.describe("Objects tab workflows (#242)", () => {
  test("the Objects tab (renamed from Beds) shows all three creation triggers", async ({ page }) => {
    await gotoLayout(page);
    await page.getByRole("tab", { name: "Objects" }).click();

    await expect(page.getByRole("button", { name: "Add bed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add compost bin" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add decoration" })).toBeVisible();
  });

  test("Add compost bin creates a linked Bed+CompostBin pair, selectable with its own compost-bin panel section", async ({
    page,
    request,
  }) => {
    await gotoLayout(page);
    await page.getByRole("tab", { name: "Objects" }).click();

    const beforeBeds = (await (await request.get("/api/beds")).json()) as { id: number }[];

    await page.getByRole("button", { name: "Add compost bin" }).click();
    const dialog = page.getByRole("dialog", { name: "Add compost bin" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("E2E Compost Bin");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toHaveCount(0);

    const afterBeds = (await (await request.get("/api/beds")).json()) as { id: number; name: string }[];
    const created = afterBeds.find((b) => !beforeBeds.some((ob) => ob.id === b.id));
    expect(created, "no new Bed row was created").toBeTruthy();
    expect(created!.name).toBe("E2E Compost Bin");

    const bins = (await (await request.get("/api/compost-bins")).json()) as { id: number; bed_id: number }[];
    const linkedBin = bins.find((b) => b.bed_id === created!.id);
    expect(linkedBin, "no CompostBin row is linked to the new Bed").toBeTruthy();

    // Creating it also selects it (BedPanel opens, heading "Edit bed") -
    // its own compost-bin section renders, distinguishing it from an
    // ordinary bed. Not `getByLabel("Name")` - that loosely substring-
    // matches the FieldHint tooltip trigger's own aria-label ("The bed's
    // display name, e.g. ...") too, which itself contains "name" - scoped
    // by the real input's own id instead.
    await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();
    await expect(page.locator("#bed-field-name")).toHaveValue("E2E Compost Bin");
    await expect(page.getByText("Fill state")).toBeVisible();

    await request.delete(`/api/beds/${created!.id}?cascade=true`).catch(() => {});
  });

  test("Add decoration creates a canvas object that selects into its own panel and deletes cleanly", async ({
    page,
    request,
  }) => {
    await gotoLayout(page);
    await page.getByRole("tab", { name: "Objects" }).click();

    await page.getByRole("button", { name: "Add decoration" }).click();
    const dialog = page.getByRole("dialog", { name: "Add decoration" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Description").fill("E2E Garden Gnome");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toHaveCount(0);

    const decorations = (await (await request.get("/api/decorations")).json()) as {
      id: number;
      name: string;
      border_geometry: Rect;
    }[];
    const decoration = decorations.find((d) => d.name === "E2E Garden Gnome");
    expect(decoration, "no Decoration row was created").toBeTruthy();

    try {
      // Creating it selects it - DecorationPanel (not BedPanel) opens with
      // its own name field pre-filled.
      await expect(page.locator("#decoration-field-name")).toHaveValue("E2E Garden Gnome");
      await expect(page.getByRole("button", { name: "Delete decoration" })).toBeVisible();

      // Switching to the Equipment tab closes the decoration's own panel
      // entirely (Objects/Plants-only rendering per #241/#242's own scope) -
      // and, confirmed directly, switching back to Objects doesn't restore
      // the selection either (unlike a bed's own selection, which does
      // survive a tab round trip) - noting this as a real, if minor,
      // interaction-consistency gap rather than silently working around it.
      await page.getByRole("tab", { name: "Equipment" }).click();
      await expect(page.getByRole("button", { name: "Delete decoration" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Objects" }).click();
      await expect(page.getByRole("button", { name: "Delete decoration" })).toHaveCount(0);

      // Reselect via the canvas (its own real geometry, in world/garden-
      // space coordinates - a decoration isn't bed-scoped) and delete via
      // its own confirm dialog.
      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      const geom = decoration!.border_geometry;
      await page.mouse.click(box.x + geom.x + geom.width / 2, box.y + geom.y + geom.height / 2);
      await expect(page.locator("#decoration-field-name")).toHaveValue("E2E Garden Gnome");
      await page.getByRole("button", { name: "Delete decoration" }).click();
      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole("button", { name: "Delete decoration" }).click();

      await expect.poll(async () => (await request.get(`/api/decorations/${decoration!.id}`)).status()).toBe(404);
    } finally {
      await request.delete(`/api/decorations/${decoration!.id}`).catch(() => {});
    }
  });

  test("Quick add creates and places a garden-bound equipment item in one click", async ({ page, request }) => {
    // A real garden is required for "place in garden" to have a target -
    // PUT /api/garden auto-creates+activates one if none exists yet.
    await request.put("/api/garden", {
      data: { name: "E2E Quick Add Garden", border_geometry: rect(0, 0, 600, 400) },
    });
    const typeSlug = `e2e-quick-add-rain-barrel-${Date.now()}`;
    const typeRes = await request.post("/api/equipment-types", {
      data: {
        slug: typeSlug,
        name: "E2E Rain Barrel",
        category: "garden_bound_functional",
        default_geometry: rect(0, 0, 60, 60),
      },
    });
    expect(typeRes.ok(), `failed to create equipment type: ${typeRes.status()} ${await typeRes.text()}`).toBeTruthy();
    const equipType = (await typeRes.json()) as { id: number };

    try {
      await gotoLayout(page);
      await page.getByRole("tab", { name: "Equipment" }).click();

      await page.getByRole("button", { name: "Quick add" }).click();
      await page.getByRole("button", { name: "E2E Rain Barrel" }).click();

      await expect
        .poll(
          async () => {
            const items = (await (await request.get("/api/bed-equipment")).json()) as {
              equipment_type: string;
              garden_id: number | null;
              bed_id: number | null;
              owned: boolean;
            }[];
            return items.find((i) => i.equipment_type === "E2E Rain Barrel") ?? null;
          },
          { message: "quick-add never created the equipment item" },
        )
        // #272 regression: QuickAddEquipment.tsx's create payload must
        // include the now-required `owned` field (added by #255) - true by
        // default, same "I have this item in hand" semantics as the other
        // two create sites.
        .toMatchObject({ garden_id: expect.any(Number), bed_id: null, owned: true });
    } finally {
      const items = (await (await request.get("/api/bed-equipment")).json()) as { id: number; equipment_type: string }[];
      for (const item of items.filter((i) => i.equipment_type === "E2E Rain Barrel")) {
        await request.delete(`/api/bed-equipment/${item.id}`).catch(() => {});
      }
      // The DELETE /api/equipment-types/{id} route takes a real integer id,
      // not a slug (`Playwright's request.delete` doesn't throw on a
      // non-2xx response, so a slug here would silently 422 and never
      // actually clean up, leaking rows into garden_test across every run -
      // confirmed this was happening: repeated runs accumulated multiple
      // "E2E Rain Barrel" EquipmentType rows, breaking the Quick-add popover's
      // own single-button assumption below).
      await request.delete(`/api/equipment-types/${equipType.id}`).catch(() => {});
    }
  });
});
