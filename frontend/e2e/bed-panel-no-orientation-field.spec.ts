import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #76 ("Remove the Bed.orientation input from
 * the bed editing panel - frontend") - no implementer outcome comment.
 * Negative-assertion coverage (confirming an old field is genuinely gone,
 * not just "not obviously broken") plus confirming saving a bed no longer
 * sends the removed field in its PATCH payload.
 */

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

test.describe("Bed panel has no Orientation input (#76)", () => {
  test("no Orientation field renders, Sun level occupies its place, and PATCH payloads never send an orientation key", async ({
    page,
    request,
  }) => {
    const bed = await createBed(request, "E2E No Orientation Bed", rect(40, 40, 100, 100));

    try {
      await page.goto("/layout");
      await page.locator("canvas").first().waitFor();
      await dismissOnboardingIfPresent(page);
      await page.getByRole("tab", { name: "Beds" }).click();
      const box = await page.locator("canvas").first().boundingBox();
      if (!box) throw new Error("canvas not visible");
      await page.mouse.click(box.x + 90, box.y + 90);
      await expect(page.getByRole("heading", { name: "Edit bed" })).toBeVisible();

      // No "Orientation" label/field anywhere in the panel.
      await expect(page.getByText("Orientation", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Orientation" })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Orientation" })).toHaveCount(0);

      // Sun level is present and usable.
      const sunLevelSelect = page.getByRole("combobox", { name: "Sun level" });
      await expect(sunLevelSelect).toBeVisible();

      // Confirm the actual PATCH payload from a real save never includes an
      // "orientation" key - not just that the UI doesn't show one.
      const patchRequestPromise = page.waitForRequest(
        (req) => req.method() === "PATCH" && req.url().includes(`/api/beds/${bed.id}`),
      );
      await sunLevelSelect.selectOption("full_sun");
      const patchRequest = await patchRequestPromise;
      const payload = patchRequest.postDataJSON();
      expect(payload).not.toHaveProperty("orientation");

      await expect
        .poll(async () => (await (await request.get(`/api/beds/${bed.id}`)).json()).sun_level, {
          message: "Sun level change never persisted",
        })
        .toBe("full_sun");
    } finally {
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
