import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #167 ("Plants Database filter dropdowns render
 * as unstyled native <select>, inconsistent with rest of app") - the
 * implementer's own outcome comment found no code change was needed (#142
 * already migrated these onto the shared `Select` primitive as a side
 * effect) and asked for a tester/visual confirm rather than trusting that
 * read of the source alone. Checks both halves of the ticket: the two
 * filter `<select>`s render with the same computed styling as the search
 * `Input` on the same row (not native OS chrome), and that filtering by
 * family/sun-level still actually narrows the results (styling-only fix,
 * behavior must be unchanged).
 */

async function createPlant(
  request: APIRequestContext,
  slug: string,
  commonName: string,
  family: string,
  sunLevel: string,
): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus", family, sun_level: sunLevel },
  });
  expect(res.ok(), `failed to create plant "${slug}": ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function gotoPlantsDatabase(page: Page): Promise<void> {
  await page.goto("/plants");
  await expect(page.getByRole("heading", { name: "Plants database" })).toBeVisible();
}

test.describe("Plants Database filter dropdown styling + behavior (#167)", () => {
  test("the family and sun-level filter selects share the search input's own computed styling, not native OS chrome", async ({
    page,
  }) => {
    await gotoPlantsDatabase(page);

    const searchInput = page.getByPlaceholder(/Search by name, botanical name, family, genus/);
    const familySelect = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "All families" }) });
    const sunSelect = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "All sun levels" }) });
    await expect(searchInput).toBeVisible();
    await expect(familySelect).toBeVisible();
    await expect(sunSelect).toBeVisible();

    const styleOf = (locator: ReturnType<Page["locator"]>) =>
      locator.evaluate((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          borderRadius: cs.borderRadius,
          height: cs.height,
          fontSize: cs.fontSize,
          borderWidth: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
        };
      });

    const [inputStyle, familyStyle, sunStyle] = await Promise.all([
      styleOf(searchInput),
      styleOf(familySelect),
      styleOf(sunSelect),
    ]);

    // A native unstyled <select> would have a browser-default
    // border/radius/height that doesn't match a Tailwind-styled Input at
    // all (this is the whole bug the ticket describes) - so a real
    // regression here would show up as a clear mismatch, not the sub-pixel
    // rounding difference an <input> vs. a <select> tag can legitimately
    // produce even sharing the exact same class list (confirmed: height
    // came back 38px vs 38.5px here, an inherent per-tag box-model quirk,
    // not a styling bug - height uses a 1px tolerance for that reason,
    // every other property compares exactly).
    function closeEnough(a: string, b: string, tolerancePx = 1): boolean {
      const pa = Number.parseFloat(a);
      const pb = Number.parseFloat(b);
      return Math.abs(pa - pb) <= tolerancePx;
    }

    expect(familyStyle.borderRadius).toBe(inputStyle.borderRadius);
    expect(closeEnough(familyStyle.height, inputStyle.height), `family select height ${familyStyle.height} vs input ${inputStyle.height}`).toBe(true);
    expect(familyStyle.fontSize).toBe(inputStyle.fontSize);
    expect(familyStyle.borderWidth).toBe(inputStyle.borderWidth);
    expect(familyStyle.borderColor).toBe(inputStyle.borderColor);

    expect(sunStyle.borderRadius).toBe(inputStyle.borderRadius);
    expect(closeEnough(sunStyle.height, inputStyle.height), `sun select height ${sunStyle.height} vs input ${inputStyle.height}`).toBe(true);
    expect(sunStyle.fontSize).toBe(inputStyle.fontSize);
    expect(sunStyle.borderWidth).toBe(inputStyle.borderWidth);
    expect(sunStyle.borderColor).toBe(inputStyle.borderColor);
  });

  test("selecting a family or sun-level filter actually narrows the results (behavior unchanged by the styling fix)", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const familyA = `E2E FilterFamily Alpha ${stamp}`;
    const familyB = `E2E FilterFamily Beta ${stamp}`;
    const slugA = `e2e-filter-alpha-${stamp}`;
    const slugB = `e2e-filter-beta-${stamp}`;
    const nameA = `E2E Filter Plant Alpha ${stamp}`;
    const nameB = `E2E Filter Plant Beta ${stamp}`;
    await createPlant(request, slugA, nameA, familyA, "full_sun");
    await createPlant(request, slugB, nameB, familyB, "shadow");

    try {
      await gotoPlantsDatabase(page);

      // No filter yet - both families' example-name text (rendered inline
      // in the collapsed family header, per PlantsDatabase.tsx's own
      // exampleNames helper) are visible.
      await expect(page.getByText(nameA)).toBeVisible();
      await expect(page.getByText(nameB)).toBeVisible();

      const familySelect = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "All families" }) });
      await familySelect.selectOption(familyA);
      await expect(page.getByText(nameA)).toBeVisible();
      await expect(page.getByText(nameB)).toHaveCount(0);

      await familySelect.selectOption("");
      await expect(page.getByText(nameB)).toBeVisible();

      const sunSelect = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "All sun levels" }) });
      await sunSelect.selectOption("shadow");
      await expect(page.getByText(nameB)).toBeVisible();
      await expect(page.getByText(nameA)).toHaveCount(0);

      await page.getByRole("button", { name: "Clear" }).click();
      await expect(page.getByText(nameA)).toBeVisible();
      await expect(page.getByText(nameB)).toBeVisible();
    } finally {
      await request.delete(`/api/plants/${slugA}`).catch(() => {});
      await request.delete(`/api/plants/${slugB}`).catch(() => {});
    }
  });
});
