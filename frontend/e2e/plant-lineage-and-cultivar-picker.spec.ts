import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #236 ("Make parent plants visible") and #257
 * ("Add-plant dialog: cultivar picker, reverse-autofill family/genus,
 * visible slug preview, optional botanical name") - both landed in
 * `PlantsDatabase.tsx`/`plant-detail/LineageSection.tsx`/`PlantDetail.tsx`
 * with no dedicated e2e coverage of their own (backend `parent_plant_slug`
 * plumbing already has `backend/tests/test_plant_parent_slug.py`; this file
 * is the frontend-behavior half). `parent_plant_slug` already existed as
 * data (#110) - both tickets are purely about surfacing/using it in the UI.
 */

async function createPlant(
  request: APIRequestContext,
  data: { slug: string; common_name: string; botanical_name?: string; family?: string; genus?: string; parent_plant_slug?: string },
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { botanical_name: "Testus e2eus", ...data },
  });
  expect(res.ok(), `failed to create plant "${data.slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function deletePlant(request: APIRequestContext, slug: string): Promise<void> {
  await request.delete(`/api/plants/${slug}?cascade=true`).catch(() => {});
}

async function gotoPlantsDatabase(page: Page): Promise<void> {
  await page.goto("/plants");
  await expect(page.getByRole("heading", { name: "Plants database" })).toBeVisible();
}

test.describe("#236 Plants Database tree: parent species / cultivar tier", () => {
  test("a species with 2+ cultivars gets its own expandable row nesting the cultivars; searching by family surfaces it directly", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const family = `E2E Lineage Family ${stamp}`;
    const genus = `E2E Lineage Genus ${stamp}`;
    const parentSlug = `e2e-lineage-parent-${stamp}`;
    const parentName = `E2E Lineage Species ${stamp}`;
    const childASlug = `e2e-lineage-child-a-${stamp}`;
    const childAName = `E2E Lineage Cultivar A ${stamp}`;
    const childBSlug = `e2e-lineage-child-b-${stamp}`;
    const childBName = `E2E Lineage Cultivar B ${stamp}`;

    await createPlant(request, { slug: parentSlug, common_name: parentName, family, genus });
    await createPlant(request, { slug: childASlug, common_name: childAName, family, genus, parent_plant_slug: parentSlug });
    await createPlant(request, { slug: childBSlug, common_name: childBName, family, genus, parent_plant_slug: parentSlug });

    try {
      await gotoPlantsDatabase(page);

      // Search narrows to this family and (per the existing convention)
      // auto-expands every matching tier, so the species row is directly
      // visible without manually clicking through family -> genus. Anchor
      // on the "(2 cultivars)" badge (unique text) rather than parentName
      // alone - the family/genus header rows' own `exampleNames` summaries
      // legitimately also contain parentName as a substring, so a bare
      // `getByText(parentName)` would be ambiguous (strict-mode violation).
      await page.getByPlaceholder(/Search by name, botanical name, family, genus/).fill(family);

      const cultivarsBadge = page.getByText("(2 cultivars)");
      await expect(cultivarsBadge).toBeVisible();
      const speciesRow = cultivarsBadge.locator("xpath=ancestor::tr[1]");
      await expect(speciesRow.getByText(parentName)).toBeVisible();

      // Cultivars start visible too - search forces every tier expanded.
      // getByRole("cell", { exact: true }) rather than getByText - the
      // family/genus header rows' own `exampleNames` summaries legitimately
      // also contain each cultivar's name as a comma-separated substring
      // of a *different* cell, so a bare text match is ambiguous.
      await expect(page.getByRole("cell", { name: childAName, exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: childBName, exact: true })).toBeVisible();

      // Clearing filters collapses the family header back down - nothing
      // below the family tier renders at all (not just re-hidden), so the
      // cultivars badge and the individual cultivar rows disappear.
      await page.getByRole("button", { name: "Clear" }).click();
      await expect(page.getByText("(2 cultivars)")).toHaveCount(0);
      await expect(page.getByRole("cell", { name: childAName, exact: true })).toHaveCount(0);
      await expect(page.getByRole("cell", { name: childBName, exact: true })).toHaveCount(0);

      // Double-clicking the species row opens the parent's own detail page
      // (it's a real openable Plant, not just a grouping label).
      await page.getByPlaceholder(/Search by name, botanical name, family, genus/).fill(family);
      const reopenedBadge = page.getByText("(2 cultivars)");
      await reopenedBadge.locator("xpath=ancestor::tr[1]").getByText(parentName).dblclick();
      await expect(page).toHaveURL(new RegExp(`/plants/${parentSlug}$`));
    } finally {
      await deletePlant(request, childASlug);
      await deletePlant(request, childBSlug);
      await deletePlant(request, parentSlug);
    }
  });

  test("a plant with exactly 1 real cultivar still gets grouped as a species (any 1+ count, not just 2+)", async ({
    page,
    request,
  }) => {
    // Verifies actual behavior against the code (`cultivars.length > 0` in
    // `groupByParentSpecies`), not the outcome comment's "2+ cultivars"
    // description of the threshold - worth pinning down explicitly with a
    // regression test either way, since a mismatch between doc and code
    // is exactly the kind of thing that's easy to accidentally "fix" into
    // a real regression later without a test here.
    const stamp = Date.now();
    const family = `E2E Lineage OneChild Family ${stamp}`;
    const genus = `E2E Lineage OneChild Genus ${stamp}`;
    const parentSlug = `e2e-lineage-onechild-parent-${stamp}`;
    const parentName = `E2E Lineage OneChild Species ${stamp}`;
    const childSlug = `e2e-lineage-onechild-child-${stamp}`;
    const childName = `E2E Lineage OneChild Cultivar ${stamp}`;

    await createPlant(request, { slug: parentSlug, common_name: parentName, family, genus });
    await createPlant(request, { slug: childSlug, common_name: childName, family, genus, parent_plant_slug: parentSlug });

    try {
      await gotoPlantsDatabase(page);
      await page.getByPlaceholder(/Search by name, botanical name, family, genus/).fill(family);

      await expect(page.getByText("(1 cultivar)")).toBeVisible();
      await expect(page.getByRole("cell", { name: childName, exact: true })).toBeVisible();
    } finally {
      await deletePlant(request, childSlug);
      await deletePlant(request, parentSlug);
    }
  });

  test("a plant with zero cultivars renders as a flat row with no cultivars badge", async ({ page, request }) => {
    const stamp = Date.now();
    const family = `E2E Lineage NoChild Family ${stamp}`;
    const genus = `E2E Lineage NoChild Genus ${stamp}`;
    const soloSlug = `e2e-lineage-nochild-solo-${stamp}`;
    const soloName = `E2E Lineage NoChild Species ${stamp}`;
    // A second, unrelated plant in the same genus so the genus tier itself
    // doesn't collapse to a family-level singleton before reaching
    // groupByParentSpecies at all (that's a related but different "single
    // member" collapse, already covered elsewhere) - this test is
    // specifically about a real 2+-member genus where nobody actually has
    // any cultivars.
    const otherSlug = `e2e-lineage-nochild-other-${stamp}`;
    const otherName = `E2E Lineage NoChild Sibling ${stamp}`;

    await createPlant(request, { slug: soloSlug, common_name: soloName, family, genus });
    await createPlant(request, { slug: otherSlug, common_name: otherName, family, genus });

    try {
      await gotoPlantsDatabase(page);
      await page.getByPlaceholder(/Search by name, botanical name, family, genus/).fill(family);

      await expect(page.getByRole("cell", { name: soloName, exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: otherName, exact: true })).toBeVisible();
      await expect(page.getByText(/\(\d+ cultivars?\)/)).toHaveCount(0);
    } finally {
      await deletePlant(request, soloSlug);
      await deletePlant(request, otherSlug);
    }
  });
});

test.describe("#236 Plant detail page: lineage cross-links", () => {
  test("a parent species's page lists its cultivars; a cultivar's page links back to its parent via the identity line", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const parentSlug = `e2e-detail-lineage-parent-${stamp}`;
    const parentName = `E2E Detail Lineage Species ${stamp}`;
    const childSlug = `e2e-detail-lineage-child-${stamp}`;
    const childName = `E2E Detail Lineage Cultivar ${stamp}`;

    await createPlant(request, { slug: parentSlug, common_name: parentName });
    await createPlant(request, { slug: childSlug, common_name: childName, parent_plant_slug: parentSlug });

    try {
      await page.goto(`/plants/${parentSlug}`);
      await expect(page.getByRole("heading", { name: `Cultivars (1)` })).toBeVisible();
      const cultivarLink = page.getByRole("link", { name: childName });
      await expect(cultivarLink).toBeVisible();
      await cultivarLink.click();
      await expect(page).toHaveURL(new RegExp(`/plants/${childSlug}$`));

      // The reverse (forward) direction: the cultivar's own identity line
      // shows a link back to its parent.
      const parentLink = page.getByRole("link", { name: parentName });
      await expect(parentLink).toBeVisible();
      await parentLink.click();
      await expect(page).toHaveURL(new RegExp(`/plants/${parentSlug}$`));
    } finally {
      await deletePlant(request, childSlug);
      await deletePlant(request, parentSlug);
    }
  });

  test("a plant with no cultivars and no parent renders no lineage section at all", async ({ page, request }) => {
    const stamp = Date.now();
    const slug = `e2e-detail-no-lineage-${stamp}`;
    const name = `E2E No Lineage Plant ${stamp}`;
    await createPlant(request, { slug, common_name: name });

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Cultivars/ })).toHaveCount(0);
    } finally {
      await deletePlant(request, slug);
    }
  });
});

test.describe("#257 Add-plant dialog: cultivar picker + reverse-autofill + slug preview + optional botanical name", () => {
  async function openAddPlantDialog(page: Page) {
    await gotoPlantsDatabase(page);
    await page.getByRole("button", { name: "Add plant" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add plant" })).toBeVisible();
    return dialog;
  }

  test("slug preview updates live as the common name is typed", async ({ page }) => {
    const dialog = await openAddPlantDialog(page);
    await expect(dialog.getByText("URL: /plants/…")).toBeVisible();

    const commonNameInput = dialog.getByRole("textbox").first();
    await commonNameInput.fill("E2E Slug Preview Plant");
    await expect(dialog.getByText("URL: /plants/e2e-slug-preview-plant")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  // KNOWN BUG (found by this test, reported back on #257 rather than fixed
  // here - tester never edits application code): the frontend deliberately
  // omits family/genus from the create payload when a parent is picked,
  // trusting the outcome comment's claim that "the backend already derives
  // its own family/genus from the parent's". It doesn't - `create_plant` in
  // `backend/app/api/routes/plants.py` only ever resolves family/genus from
  // the payload's own `family`/`genus` strings (via `find_or_create_family`/
  // `find_or_create_genus`), with zero reference to `parent_plant_slug`.
  // Net effect: creating a cultivar through this dialog silently creates a
  // plant with NO family/genus at all, contradicting both the dialog's own
  // "(from parent)" readout and #236's Plants Database tree grouping (which
  // groups by family then genus - a cultivar with neither never nests under
  // its parent's family/genus group). `test.fail()` keeps this documented
  // and running (not deleted, not silently skipped) without failing the
  // whole suite; flip back to a plain `test` once #257 (or a follow-up) adds
  // the missing derivation, in either the frontend (send parent.family/
  // parent.genus explicitly) or backend (derive server-side from
  // parent_plant_slug).
  test("picking a parent collapses family/genus to a read-only 'from parent' line and omits them from the create payload; botanical name is optional", async ({
    page,
    request,
  }) => {
    test.fail();
    const stamp = Date.now();
    const family = `E2E AddCultivar Family ${stamp}`;
    const genus = `E2E AddCultivar Genus ${stamp}`;
    const parentSlug = `e2e-addcultivar-parent-${stamp}`;
    const parentName = `E2E AddCultivar Species ${stamp}`;
    const childName = `E2E AddCultivar Child ${stamp}`;
    // Matches PlantsDatabase.tsx's own `slugify` - lowercase, non-alphanumeric
    // runs collapsed to a single "-", no leading/trailing "-".
    const childSlug = `e2e-addcultivar-child-${stamp}`;

    await createPlant(request, { slug: parentSlug, common_name: parentName, family, genus });

    try {
      const dialog = await openAddPlantDialog(page);

      const commonNameInput = dialog.getByRole("textbox").first();
      await commonNameInput.fill(childName);

      await dialog.getByRole("button", { name: "Pick a parent plant…" }).click();
      await page.getByPlaceholder("Search plants…").fill(parentName);
      await page.getByRole("button", { name: new RegExp(parentName) }).click();

      // Family/genus are now a read-only line, not editable inputs.
      await expect(dialog.getByText(`Family: ${family} · Genus: ${genus} (from parent)`)).toBeVisible();
      await expect(dialog.getByLabel("Family (optional)")).toHaveCount(0);
      await expect(dialog.getByLabel("Genus (optional)")).toHaveCount(0);

      // Botanical name left blank entirely - not required to submit.
      await dialog.getByRole("button", { name: "Create" }).click();

      await expect(page).toHaveURL(new RegExp(`/plants/${childSlug}$`));
      const created = await (await request.get(`/api/plants/${childSlug}`)).json();
      expect(created.parent_plant_slug).toBe(parentSlug);
      expect(created.botanical_name).toBe("");
      // Family/genus were derived server-side from the parent, not sent
      // blank/independently from the client.
      expect(created.family?.name).toBe(family);
      expect(created.genus?.name).toBe(genus);
    } finally {
      await deletePlant(request, childSlug);
      await deletePlant(request, parentSlug);
    }
  });

  test("clearing a picked parent restores editable family/genus autocomplete fields", async ({ page, request }) => {
    const stamp = Date.now();
    const parentSlug = `e2e-addcultivar-clear-parent-${stamp}`;
    const parentName = `E2E AddCultivar Clear Species ${stamp}`;
    await createPlant(request, { slug: parentSlug, common_name: parentName, family: `E2E Clear Family ${stamp}` });

    try {
      const dialog = await openAddPlantDialog(page);
      await dialog.getByRole("button", { name: "Pick a parent plant…" }).click();
      await page.getByPlaceholder("Search plants…").fill(parentName);
      await page.getByRole("button", { name: new RegExp(parentName) }).click();
      await expect(dialog.getByText(/from parent/)).toBeVisible();

      await dialog.getByRole("button", { name: "Clear parent plant" }).click();
      await expect(dialog.getByText(/from parent/)).toHaveCount(0);
      await expect(dialog.getByText("Family (optional)")).toBeVisible();
      await expect(dialog.getByText("Genus (optional)")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Pick a parent plant…" })).toBeVisible();

      await dialog.getByRole("button", { name: "Cancel" }).click();
    } finally {
      await deletePlant(request, parentSlug);
    }
  });

  test("submitting a duplicate common name/slug surfaces the backend's 409 as an inline error, not a silent failure", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-addcultivar-dup-${stamp}`;
    const name = `E2E AddCultivar Dup ${stamp}`;
    await createPlant(request, { slug, common_name: name });

    try {
      const dialog = await openAddPlantDialog(page);
      const commonNameInput = dialog.getByRole("textbox").first();
      await commonNameInput.fill(name);
      await expect(dialog.getByText(`URL: /plants/${slug}`)).toBeVisible();

      await dialog.getByRole("button", { name: "Create" }).click();

      // Dialog stays open with a visible error, not a silent no-op or crash.
      await expect(dialog.getByRole("heading", { name: "Add plant" })).toBeVisible();
      await expect(dialog.locator("p.text-destructive")).toBeVisible();

      await dialog.getByRole("button", { name: "Cancel" }).click();
    } finally {
      await deletePlant(request, slug);
    }
  });

  test("submitting with a blank common name is blocked client-side (no request sent)", async ({ page }) => {
    const dialog = await openAddPlantDialog(page);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog.getByText("Common name is required.")).toBeVisible();
    // Dialog remains open on validation failure.
    await expect(dialog.getByRole("heading", { name: "Add plant" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});
