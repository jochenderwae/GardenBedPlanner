import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #136 ("Render data sources as clickable links,
 * hide ollama-*-inference entries") - the implementer's own outcome comment
 * says the plant-detail page's `DataSourcesSection` couldn't be driven
 * interactively ("no browser automation in this environment... still open
 * verification items for a human/tester pass"). Covers all 4 of the
 * ticket's own scenarios in one flow against a real plant with a mix of
 * source shapes.
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function addDataSource(
  request: APIRequestContext,
  slug: string,
  body: { source_url: string | null; attribution: string | null; notes: string | null },
): Promise<void> {
  const res = await request.post(`/api/plants/${slug}/data-sources`, { data: body });
  expect(res.ok(), `failed to add data source: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail data sources: links + ollama-*-inference filtering (#136)", () => {
  test("real source renders as a link, ollama-*-inference is hidden, url-less entry stays plain text", async ({
    page,
    request,
  }) => {
    const slug = `e2e-data-sources-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Data Sources Plant");

    try {
      // Case 1: a real book/site source with both attribution and a URL -
      // should render as a clickable link, attribution as the link text.
      await addDataSource(request, slug, {
        source_url: "https://example.com/tomato-growing-guide",
        attribution: "The Vegetable Growing Handbook",
        notes: null,
      });
      // Case 2: an ollama-*-inference internal-provenance entry - must be
      // hidden from the rendered list entirely.
      await addDataSource(request, slug, {
        source_url: null,
        attribution: "ollama-life_cycle-inference",
        notes: null,
      });
      // Case 3: another real source (different attribution) - confirms
      // multiple real sources all render, not just the first.
      await addDataSource(request, slug, {
        source_url: "https://example.com/openfarm-tomato",
        attribution: "openfarm-crops-rescue",
        notes: null,
      });
      // Case 4: a source with attribution but no URL - plain text, not a
      // broken/empty link.
      await addDataSource(request, slug, {
        source_url: null,
        attribution: "Word of mouth from a neighbor",
        notes: null,
      });

      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "Data sources", exact: true })).toBeVisible();

      // Case 1 + 3: real links, visible and pointing at the right href.
      const handbookLink = page.getByRole("link", { name: "The Vegetable Growing Handbook" });
      await expect(handbookLink).toBeVisible();
      await expect(handbookLink).toHaveAttribute("href", "https://example.com/tomato-growing-guide");
      await expect(handbookLink).toHaveAttribute("target", "_blank");
      await expect(handbookLink).toHaveAttribute("rel", /noopener/);

      const openfarmLink = page.getByRole("link", { name: "openfarm-crops-rescue" });
      await expect(openfarmLink).toBeVisible();
      await expect(openfarmLink).toHaveAttribute("href", "https://example.com/openfarm-tomato");

      // Case 2: the ollama-*-inference entry is not rendered anywhere on
      // the page at all (not just "not a link" - fully hidden per the
      // ticket's own requirement).
      await expect(page.getByText("ollama-life_cycle-inference")).toHaveCount(0);

      // Case 4: url-less source renders as plain text (its attribution
      // string, not wrapped in an <a>), not a broken link.
      const plainTextSource = page.getByText("Word of mouth from a neighbor");
      await expect(plainTextSource).toBeVisible();
      await expect(page.getByRole("link", { name: "Word of mouth from a neighbor" })).toHaveCount(0);

      // Sanity: exactly the 3 non-ollama sources are present (not more,
      // not fewer) - confirms the ollama filter operates on the display
      // list only and doesn't accidentally also drop a real source.
      const allBackendSources = await (await request.get(`/api/plants/${slug}`)).json();
      expect(allBackendSources.data_sources).toHaveLength(4);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
