import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Real-browser coverage for #121 ("Growing information display") - the
 * implementer's own outcome comment explicitly leaves the sources-popup
 * interaction for the tester role ("No browser automation available in
 * this environment... left for the tester role to confirm visually").
 */

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", {
    data: { slug, common_name: commonName, botanical_name: "Testus e2eus" },
  });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function addGrowingInfo(
  request: APIRequestContext,
  slug: string,
  body: { text: string; source_url?: string | null; attribution?: string | null; record_type?: "raw" | "consolidated" },
): Promise<void> {
  const res = await request.post(`/api/plants/${slug}/growing-information`, { data: body });
  expect(res.ok(), `failed to add growing-information: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe("Plant-detail Growing information display (#121)", () => {
  test("a consolidated entry with multiple raw sources shows only the summary by default, with a working sources popup", async ({
    page,
    request,
  }) => {
    const slug = `e2e-growing-info-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growing Info Plant");

    try {
      await addGrowingInfo(request, slug, {
        text: "Book A's raw excerpt about this plant's growing habits.",
        source_url: "https://example.com/book-a",
        attribution: "Book A: The Vegetable Garden",
        record_type: "raw",
      });
      await addGrowingInfo(request, slug, {
        text: "Book B's raw excerpt with different advice.",
        source_url: "https://example.com/book-b",
        attribution: "Book B: Practical Gardening",
        record_type: "raw",
      });
      await addGrowingInfo(request, slug, {
        text: "This is the AI-synthesized summary combining both books.",
        attribution: "Ollama synthesis of Book A, Book B",
        record_type: "consolidated",
      });

      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growing Info Plant" })).toBeVisible();

      // #237 round 2 promoted this section out of the satellite/"Show more
      // details" list, restyled as a plain quiet block with no <h2> of its
      // own (it reads as an extension of Description now) - scoping by a
      // "Growing information" heading no longer works, `page` directly is
      // safe since nothing else on this page renders this exact content.
      const section = page;
      await expect(section.getByText("This is the AI-synthesized summary combining both books.")).toBeVisible();
      // Raw texts not shown directly - only the consolidated summary, by
      // default, per the ticket's own requirement.
      await expect(section.getByText("Book A's raw excerpt")).not.toBeVisible();
      await expect(section.getByText("Book B's raw excerpt")).not.toBeVisible();

      await expect(section.getByText("This text is an AI summary.")).toBeVisible();
      const sourcesButton = section.getByRole("button", { name: "sources" });
      await expect(sourcesButton).toBeVisible();

      await sourcesButton.click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Sources" })).toBeVisible();
      await expect(dialog.getByText("Book A's raw excerpt")).toBeVisible();
      await expect(dialog.getByText("Book B's raw excerpt")).toBeVisible();

      const bookALink = dialog.getByRole("link", { name: "Book A: The Vegetable Garden" });
      await expect(bookALink).toBeVisible();
      await expect(bookALink).toHaveAttribute("href", "https://example.com/book-a");
      const bookBLink = dialog.getByRole("link", { name: "Book B: Practical Gardening" });
      await expect(bookBLink).toHaveAttribute("href", "https://example.com/book-b");

      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).not.toBeVisible();
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("no consolidated entry yet falls back to showing raw text(s) directly, with attribution linking out", async ({
    page,
    request,
  }) => {
    const slug = `e2e-growing-info-raw-only-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growing Info Raw Only Plant");

    try {
      await addGrowingInfo(request, slug, {
        text: "Only a raw excerpt exists so far, no AI summary yet.",
        source_url: "https://example.com/book-c",
        attribution: "Book C: Old Gardening Wisdom",
        record_type: "raw",
      });

      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growing Info Raw Only Plant" })).toBeVisible();

      // #237 round 2 promoted this section out of the satellite/"Show more
      // details" list, restyled as a plain quiet block with no <h2> of its
      // own (it reads as an extension of Description now) - scoping by a
      // "Growing information" heading no longer works, `page` directly is
      // safe since nothing else on this page renders this exact content.
      const section = page;
      await expect(section.getByText("Only a raw excerpt exists so far")).toBeVisible();
      await expect(section.getByText("This text is an AI summary.")).not.toBeVisible();

      const attributionLink = section.getByRole("link", { name: "Book C: Old Gardening Wisdom" });
      await expect(attributionLink).toBeVisible();
      await expect(attributionLink).toHaveAttribute("href", "https://example.com/book-c");
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a consolidated entry with no other raw sources shows no sources link at all", async ({ page, request }) => {
    const slug = `e2e-growing-info-solo-consolidated-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growing Info Solo Consolidated Plant");

    try {
      await addGrowingInfo(request, slug, {
        text: "A consolidated summary with nothing else to cite.",
        attribution: "Ollama synthesis",
        record_type: "consolidated",
      });

      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growing Info Solo Consolidated Plant" })).toBeVisible();

      // #237 round 2 promoted this section out of the satellite/"Show more
      // details" list, restyled as a plain quiet block with no <h2> of its
      // own (it reads as an extension of Description now) - scoping by a
      // "Growing information" heading no longer works, `page` directly is
      // safe since nothing else on this page renders this exact content.
      const section = page;
      await expect(section.getByText("A consolidated summary with nothing else to cite.")).toBeVisible();
      await expect(section.getByRole("button", { name: "sources" })).toHaveCount(0);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });

  test("a plant with no growing_information at all renders no section", async ({ page, request }) => {
    const slug = `e2e-growing-info-none-plant-${Date.now()}`;
    await createPlant(request, slug, "E2E Growing Info None Plant");

    try {
      await page.goto(`/plants/${slug}`);
      await expect(page.getByRole("heading", { name: "E2E Growing Info None Plant" })).toBeVisible();
      // GrowingInfoSection returns null entirely when there's nothing to
      // show (no heading of its own to check for absence post-#237 - see
      // this file's other tests) - its own distinctive copy is the
      // reliable absence signal instead.
      await expect(page.getByText("This text is an AI summary.")).toHaveCount(0);
    } finally {
      await request.delete(`/api/plants/${slug}`).catch(() => {});
    }
  });
});
