import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #122 ("Companions should be displayed as
 * multiple columns") - the implementer's own outcome comment explicitly
 * left the actual popover open/close/click-away/pick interaction
 * unverified (no browser-automation tool available, no e2e spec existed
 * for the Companions section at all). Covers all 4 of the ticket's own
 * "how to test" steps: no picker visible at rest, the Good column's
 * "+ Add plant" popover opens/searches/picks/closes, same for Bad, and
 * removing an existing companion still works.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function gotoPlant(page: Page, slug: string): Promise<void> {
  await page.goto(`/plants/${slug}`);
  await expect(page.getByRole("heading", { name: "Companions" })).toBeVisible();
}

test.describe("Plant-detail Companions section: per-column add-plant popover (#122)", () => {
  test("no picker is visible at rest; the Good column's popover opens on click, searches, picks, and closes", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const mainSlug = `e2e-companion-main-${stamp}`;
    const goodSlug = `e2e-companion-good-${stamp}`;
    const goodName = `E2E Companion Good Pick ${stamp}`;
    await createPlant(request, mainSlug, `E2E Companion Main ${stamp}`);
    await createPlant(request, goodSlug, goodName);

    try {
      await gotoPlant(page, mainSlug);

      // At rest: no search input visible anywhere in the Companions
      // section - the picker only exists once a column's own "Add plant"
      // row is clicked (the whole point of this ticket vs. the old
      // always-open inline picker).
      await expect(page.getByPlaceholder("Search plants…")).toHaveCount(0);

      const addButtons = page.getByRole("button", { name: "Add plant" });
      await expect(addButtons).toHaveCount(2); // one per column (Good, Bad)
      const goodAddButton = addButtons.first();
      await goodAddButton.click();

      const searchInput = page.getByPlaceholder("Search plants…");
      await expect(searchInput).toBeVisible();
      await searchInput.fill(goodName);
      const match = page.getByRole("button", { name: new RegExp(goodName) });
      await expect(match).toBeVisible();
      await match.click();

      // Picking closes the popover - the search input disappears again.
      await expect(page.getByPlaceholder("Search plants…")).toHaveCount(0);

      // The new companion persisted server-side and is now listed.
      await expect
        .poll(async () => {
          const detail = await (await request.get(`/api/plants/${mainSlug}`)).json();
          return (detail.companions as { companion_plant_slug: string; relationship: string }[]).some(
            (c) => c.companion_plant_slug === goodSlug && c.relationship === "good",
          );
        }, { message: "good companion never persisted" })
        .toBe(true);
      // exact:true - a "Added companion <slug>" snackbar also contains the
      // slug as a substring, which would otherwise strict-mode-collide
      // with the row's own bare-slug text.
      await expect(page.getByText(goodSlug, { exact: true })).toBeVisible();
    } finally {
      await request.delete(`/api/plants/${mainSlug}/companions/${goodSlug}`).catch(() => {});
      await request.delete(`/api/plants/${mainSlug}`).catch(() => {});
      await request.delete(`/api/plants/${goodSlug}`).catch(() => {});
    }
  });

  test("the Bad column's popover works the same way, independently from Good", async ({ page, request }) => {
    const stamp = Date.now();
    const mainSlug = `e2e-companion-main2-${stamp}`;
    const badSlug = `e2e-companion-bad-${stamp}`;
    const badName = `E2E Companion Bad Pick ${stamp}`;
    await createPlant(request, mainSlug, `E2E Companion Main2 ${stamp}`);
    await createPlant(request, badSlug, badName);

    try {
      await gotoPlant(page, mainSlug);

      const addButtons = page.getByRole("button", { name: "Add plant" });
      const badAddButton = addButtons.last();
      await badAddButton.click();

      const searchInput = page.getByPlaceholder("Search plants…");
      await expect(searchInput).toBeVisible();
      await searchInput.fill(badName);
      await page.getByRole("button", { name: new RegExp(badName) }).click();

      await expect(page.getByPlaceholder("Search plants…")).toHaveCount(0);
      await expect
        .poll(async () => {
          const detail = await (await request.get(`/api/plants/${mainSlug}`)).json();
          return (detail.companions as { companion_plant_slug: string; relationship: string }[]).some(
            (c) => c.companion_plant_slug === badSlug && c.relationship === "bad",
          );
        }, { message: "bad companion never persisted" })
        .toBe(true);
      await expect(page.getByText(badSlug, { exact: true })).toBeVisible();
    } finally {
      await request.delete(`/api/plants/${mainSlug}/companions/${badSlug}`).catch(() => {});
      await request.delete(`/api/plants/${mainSlug}`).catch(() => {});
      await request.delete(`/api/plants/${badSlug}`).catch(() => {});
    }
  });

  test("removing an existing companion still works", async ({ page, request }) => {
    const stamp = Date.now();
    const mainSlug = `e2e-companion-main3-${stamp}`;
    const companionSlug = `e2e-companion-remove-${stamp}`;
    await createPlant(request, mainSlug, `E2E Companion Main3 ${stamp}`);
    await createPlant(request, companionSlug, `E2E Companion Removable ${stamp}`);
    const companionRes = await request.post(`/api/plants/${mainSlug}/companions`, {
      data: { plant_slug: mainSlug, companion_plant_slug: companionSlug, relationship: "good" },
    });
    expect(companionRes.ok(), `failed to seed companion: ${companionRes.status()}`).toBeTruthy();

    try {
      await gotoPlant(page, mainSlug);
      await expect(page.getByText(companionSlug, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Remove good companion" }).click();
      // exact:true - a "Removed companion <slug>" snackbar (with an Undo
      // action) also contains the slug as a substring and is expected to
      // still be present right after removal; only the row's own bare-slug
      // text needs to be gone.
      await expect(page.getByText(companionSlug, { exact: true })).toHaveCount(0);

      await expect
        .poll(async () => {
          const detail = await (await request.get(`/api/plants/${mainSlug}`)).json();
          return (detail.companions as { companion_plant_slug: string }[]).some(
            (c) => c.companion_plant_slug === companionSlug,
          );
        }, { message: "companion still persisted server-side after removal" })
        .toBe(false);
    } finally {
      await request.delete(`/api/plants/${mainSlug}/companions/${companionSlug}`).catch(() => {});
      await request.delete(`/api/plants/${mainSlug}`).catch(() => {});
      await request.delete(`/api/plants/${companionSlug}`).catch(() => {});
    }
  });
});
