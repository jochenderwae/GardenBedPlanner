import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #87 ("Fix copy that implies open-ground
 * planting exists outside of a bed") - a copy-only change to Layout.tsx's
 * Plants-tab help text, plus confirming placing a plant into a "Ground"-
 * category bed (the actual real-world stand-in for "open ground" -
 * Planting.bed_id is required, there's no true outside-any-bed placement)
 * still works exactly as before.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(
  request: APIRequestContext,
  name: string,
  geometry: Rect,
  category: string | null = null,
): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry, category } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createPlant(request: APIRequestContext, slug: string, commonName: string): Promise<void> {
  const res = await request.post("/api/plants", { data: { slug, common_name: commonName, botanical_name: "Testus e2eus" } });
  expect(res.ok(), `failed to create plant: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("Plants-tab help text doesn't imply open-ground planting is separate from a bed (#87)", () => {
  test("neither the unarmed nor armed-plant help text mentions 'open ground', and placing into a Ground-category bed still works", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E Ground Bed", rect(40, 40, 200, 200), "Ground");
    const slug = `e2e-ground-copy-${Date.now()}`;
    // Deliberately doesn't contain the substring "open ground" itself -
    // this test asserts the help text never contains that phrase, so the
    // plant's own name mustn't accidentally supply it.
    const commonName = "E2E Ground Bed Test Plant";
    await createPlant(request, slug, commonName);

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Plants" }).click();

      // --- Step 1/2: unarmed help text ---
      const helpText = page.getByText(/Pick a plant above, then draw where it goes/);
      await expect(helpText).toBeVisible();
      const unarmedText = await helpText.textContent();
      expect(unarmedText).not.toMatch(/open ground/i);

      // Arm the plant and check the armed-state help text too (the
      // "including open ground" aside was on both variants per the
      // ticket's own technical analysis).
      await page.getByRole("button", { name: "Pick a plant" }).click();
      await page.getByRole("button", { name: new RegExp(commonName) }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const armedHelpText = page.getByText(new RegExp(`place ${commonName}`, "i"));
      await expect(armedHelpText).toBeVisible();
      const armedText = await armedHelpText.textContent();
      expect(armedText).not.toMatch(/open ground/i);
      expect(armedText).toMatch(/inside any bed/i);

      // --- Step 3: placing into the Ground-category bed still works ---
      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      // World (140,140) = bed(40,40) + local(100,100), well inside the bed.
      await page.mouse.click(box.x + 140, box.y + 140);

      await expect
        .poll(async () => {
          const plantings = (await (await request.get("/api/plantings")).json()) as { plant_slug: string; bed_id: number }[];
          return plantings.find((p) => p.plant_slug === slug)?.bed_id;
        }, { message: "planting was never created against the Ground bed" })
        .toBe(bed.id);
    } finally {
      const plantings = (await (await request.get("/api/plantings")).json()) as { id: number; plant_slug: string }[];
      for (const p of plantings.filter((x) => x.plant_slug === slug)) await request.delete(`/api/plantings/${p.id}`).catch(() => {});
      await request.delete(`/api/plants/${slug}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
