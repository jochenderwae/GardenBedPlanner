import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #231 ("Task reminder snooze - in-app
 * affordance") - the implementer's own outcome comment verified this only
 * via a throwaway (uncommitted) Playwright script. `isSnoozed`'s own pure
 * logic now has Vitest coverage (`taskAgenda.test.ts`); this covers the
 * interactive `SnoozeDialog` flow across its three real entry points.
 */

function isoDaysFromNow(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function createAction(request: APIRequestContext, overrides: Record<string, unknown>): Promise<{ id: number }> {
  const res = await request.post("/api/actions", {
    data: { action_type: "prepare_bed", status: "pending", due_date_start: isoDaysFromNow(0), due_date_end: isoDaysFromNow(30), ...overrides },
  });
  expect(res.ok(), `failed to create action: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function fetchAction(request: APIRequestContext, id: number) {
  return (await (await request.get(`/api/actions/${id}`)).json()) as { snoozed_until: string | null; status: string };
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** `actionable_now` has no bed/garden scoping to lean on for a clean
 * baseline (same reasoning `mobile-home.spec.ts` documents at length) -
 * temporarily and reversibly snoozes away any pre-existing actionable task
 * so the mobile Home hero test below gets a deterministic pick regardless of
 * ambient `garden_test` data. */
async function withClearedActionableNow<T>(request: APIRequestContext, fn: () => Promise<T>): Promise<T> {
  const existingRes = await request.get("/api/actions?actionable_now=true");
  const existing = (await existingRes.json()) as { id: number; snoozed_until: string | null }[];
  try {
    for (const a of existing) {
      await request.patch(`/api/actions/${a.id}`, { data: { snoozed_until: "2099-12-31" } });
    }
    return await fn();
  } finally {
    for (const a of existing) {
      await request.patch(`/api/actions/${a.id}`, { data: { snoozed_until: a.snoozed_until } }).catch(() => {});
    }
  }
}

test.describe("Task reminder snooze - in-app affordance (#231)", () => {
  test("TaskDetail: each preset (Tomorrow / This weekend / Next week) resolves to the correct date and updates the Reminder row", async ({
    page,
    request,
  }) => {
    const action = await createAction(request, {});

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByText("Not snoozed")).toBeVisible();

      // --- Tomorrow ---
      await page.getByRole("button", { name: "Snooze" }).click();
      const dialog1 = page.getByRole("dialog");
      await dialog1.getByRole("radio", { name: "Tomorrow" }).click();
      await dialog1.getByRole("button", { name: "Snooze", exact: true }).click();
      await expect(page.getByText(/^Snoozed until/)).toBeVisible();
      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "Tomorrow preset never persisted" })
        .toBe(isoDaysFromNow(1));

      // --- This weekend (or Next weekend if today is Saturday - either
      // way, the resolved date must be strictly in the future, never
      // today) ---
      await page.getByRole("button", { name: "Change" }).click();
      const dialog2 = page.getByRole("dialog");
      const weekendRadio = dialog2.getByRole("radio", { name: /weekend/i });
      await expect(weekendRadio).toBeVisible();
      await weekendRadio.click();
      await dialog2.getByRole("button", { name: "Snooze", exact: true }).click();
      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "weekend preset never persisted" })
        .not.toBeNull();
      const afterWeekend = await fetchAction(request, action.id);
      expect(afterWeekend.snoozed_until! > isoDaysFromNow(0)).toBe(true);

      // --- Next week ---
      await page.getByRole("button", { name: "Change" }).click();
      const dialog3 = page.getByRole("dialog");
      await dialog3.getByRole("radio", { name: "Next week" }).click();
      await dialog3.getByRole("button", { name: "Snooze", exact: true }).click();
      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "Next week preset never persisted" })
        .not.toBeNull();
      const afterNextWeek = await fetchAction(request, action.id);
      expect(afterNextWeek.snoozed_until! > isoDaysFromNow(0)).toBe(true);
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("TaskDetail: the custom-date option enforces a minimum of tomorrow and the chosen date saves correctly", async ({ page, request }) => {
    const action = await createAction(request, {});

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      await page.getByRole("button", { name: "Snooze" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: "Custom date" }).click();
      const dateInput = dialog.locator("#snooze-field-custom-date");
      await expect(dateInput).toHaveAttribute("min", isoDaysFromNow(1));

      const target = isoDaysFromNow(10);
      await dateInput.fill(target);
      await dialog.getByRole("button", { name: "Snooze", exact: true }).click();

      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "custom date never persisted" })
        .toBe(target);
      await expect(page.getByText(/^Snoozed until/)).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("TaskDetail: 'This weekend' becomes 'Next weekend' and targets Saturday+7 when today is already a Saturday", async ({ page, request }) => {
    // 2026-08-08 is a Saturday.
    await page.clock.install({ time: new Date("2026-08-08T12:00:00") });
    const action = await createAction(request, { due_date_start: "2026-08-08", due_date_end: "2026-09-08" });

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      await page.getByRole("button", { name: "Snooze" }).click();
      const dialog = page.getByRole("dialog");
      const weekendRadio = dialog.getByRole("radio", { name: "Next weekend" });
      await expect(weekendRadio).toBeVisible();
      await weekendRadio.click();
      await dialog.getByRole("button", { name: "Snooze", exact: true }).click();

      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "Next weekend preset never persisted" })
        .toBe("2026-08-15"); // Saturday + 7, not today (2026-08-08)
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("TaskDetail: 'Clear snooze' clears immediately with no dialog, and Undo restores the previous snoozed_until", async ({ page, request }) => {
    const action = await createAction(request, { snoozed_until: isoDaysFromNow(5) });

    try {
      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);
      await expect(page.getByText(/^Snoozed until/)).toBeVisible();

      await page.getByRole("button", { name: "Clear snooze" }).click();
      await expect(page.getByText("Not snoozed")).toBeVisible();
      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "Clear snooze never persisted" })
        .toBeNull();

      const status = page.locator('[role="status"]');
      await expect(status).toBeVisible();
      await expect(status).toContainText("Snooze cleared");
      await status.getByRole("button", { name: "Undo" }).click();

      await expect(page.getByText(/^Snoozed until/)).toBeVisible();
      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "Undo never restored the previous snoozed_until" })
        .toBe(isoDaysFromNow(5));
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("TaskDetail: a submit failure keeps the dialog open with the selection preserved and shows an inline error", async ({ page, request }) => {
    const action = await createAction(request, {});

    try {
      await page.route(`**/api/actions/${action.id}`, (route) => {
        if (route.request().method() === "PATCH") {
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "simulated failure" }) });
        }
        return route.continue();
      });

      await page.goto(`/tasks/${action.id}`);
      await dismissOnboardingIfPresent(page);

      await page.getByRole("button", { name: "Snooze" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: "Next week" }).click();
      await dialog.getByRole("button", { name: "Snooze", exact: true }).click();

      await expect(dialog.getByRole("radio", { name: "Next week" })).toHaveAttribute("aria-checked", "true");
      await expect(dialog.locator("form p.text-destructive")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Snooze", exact: true })).toBeVisible();

      const stillNotSnoozed = await fetchAction(request, action.id);
      expect(stillNotSnoozed.snoozed_until).toBeNull();
    } finally {
      await page.unroute(`**/api/actions/${action.id}`);
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("TaskAgendaView: the icon-only snooze quick action shows a muted 'Snoozed until X' suffix, and the task still appears normally", async ({
    page,
    request,
  }) => {
    const dueDate = isoDaysFromNow(20);
    const action = await createAction(request, {
      action_type: "collect_seeds",
      due_date_start: isoDaysFromNow(0),
      due_date_end: dueDate,
    });

    try {
      await page.goto("/agenda");
      await dismissOnboardingIfPresent(page);
      await page.getByRole("radio", { name: "List" }).click();

      const row = page.getByRole("link", { name: /^Collect seeds/ });
      await expect(row).toBeVisible();
      await expect(row.getByText(/^Snoozed until/)).toHaveCount(0);

      await page.getByRole("button", { name: "Snooze reminder" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: "Tomorrow" }).click();
      await dialog.getByRole("button", { name: "Snooze", exact: true }).click();

      // Still visible (snoozing suppresses reminders only, not
      // visibility), now with the muted suffix.
      await expect(row).toBeVisible();
      await expect(row.getByText(/^Snoozed until/)).toBeVisible();
      await expect
        .poll(async () => (await fetchAction(request, action.id)).snoozed_until, { message: "snooze from the agenda row never persisted" })
        .toBe(isoDaysFromNow(1));
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("MobileHome hero: a Snooze button is offered alongside Mark done (non-harvest) and Log harvest (harvest-type); secondary rows get none", async ({
    page,
    request,
  }) => {
    await withClearedActionableNow(request, async () => {
      const hero = await createAction(request, {
        action_type: "harvest",
        due_date_start: isoDaysFromNow(-2),
        due_date_end: isoDaysFromNow(0),
      });
      const secondary = await createAction(request, {
        action_type: "sow",
        due_date_start: isoDaysFromNow(-1),
        due_date_end: isoDaysFromNow(1),
      });

      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await dismissOnboardingIfPresent(page);
        await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
        await expect(page.getByText(/^Harvest/)).toBeVisible();

        // Harvest-type hero: Log harvest + Snooze, no Mark done.
        await expect(page.getByRole("link", { name: "Log harvest" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Mark done" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Snooze" })).toBeVisible();

        // Secondary row (the "sow" task): tap-through only, no quick
        // actions of any kind, including snooze.
        const secondaryLink = page.getByRole("link", { name: /^Sow/ });
        await expect(secondaryLink).toBeVisible();
        await expect(page.getByRole("button", { name: "Snooze" })).toHaveCount(1); // only the hero's
        await expect(secondaryLink.getByRole("button")).toHaveCount(0);
      } finally {
        await request.delete(`/api/actions/${hero.id}`).catch(() => {});
        await request.delete(`/api/actions/${secondary.id}`).catch(() => {});
      }
    });
  });
});
