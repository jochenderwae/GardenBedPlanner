import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #224 ("Mobile Home tab: surface the single most
 * urgent actionable task") - the implementer's own outcome comment verified
 * this only via a throwaway (uncommitted) Playwright script. Mobile-only per
 * the ticket's own settled Platform note - no desktop equivalent exists.
 *
 * `actionable_now=true` (the backend filter this view reads through) has no
 * bed/garden scoping of its own to lean on for a clean starting state (see
 * `backend/app/api/routes/actions.py`'s own `or_(bed_id in active garden,
 * bed_id is null)` - a bed-less action always counts) - real ambient
 * `garden_test` data could already have actionable tasks at unpredictable
 * urgencies. `withClearedActionableNow` below temporarily snoozes every
 * *pre-existing* actionable task out of the way (fully reversible - restores
 * each one's own original `snoozed_until` in a `finally`, never touches
 * status/due dates) so each test gets a deterministic, real "nothing else in
 * the running" baseline instead of guessing at ambient state or hoping ancient
 * due dates always win the urgency sort.
 */

type ActionRow = { id: number; snoozed_until: string | null };

async function actionableNowActions(request: APIRequestContext): Promise<ActionRow[]> {
  const res = await request.get("/api/actions?actionable_now=true");
  expect(res.ok(), `failed to list actionable_now actions: ${res.status()}`).toBeTruthy();
  return res.json();
}

async function withClearedActionableNow<T>(request: APIRequestContext, fn: () => Promise<T>): Promise<T> {
  const existing = await actionableNowActions(request);
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

async function createAction(
  request: APIRequestContext,
  overrides: Record<string, unknown>,
): Promise<{ id: number }> {
  const res = await request.post("/api/actions", {
    data: { action_type: "prepare_bed", status: "pending", due_date_start: null, due_date_end: null, ...overrides },
  });
  expect(res.ok(), `failed to create action: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function gotoMobileHome(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
}

test.describe("Mobile Home tab (#224)", () => {
  test("with zero actionable tasks, the explicit all-caught-up empty state renders", async ({ page, request }) => {
    await withClearedActionableNow(request, async () => {
      await gotoMobileHome(page);
      await expect(page.getByText("All caught up — nothing urgent right now.")).toBeVisible();
      const link = page.getByRole("link", { name: "View full agenda" });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/\/agenda$/);
    });
  });

  test("hero + up to 4 secondary tasks sorted by urgency, remainder collapsed into an 'N more' line, overdue vs due-by styling", async ({
    page,
    request,
  }) => {
    const created: { id: number }[] = [];
    await withClearedActionableNow(request, async () => {
      try {
        // 6 actions, ascending due_date_end urgency - action1 is overdue
        // (due yesterday), action2 is due exactly today (not overdue - the
        // check is strictly `<` today), the rest are increasingly further
        // out. Distinct action_type per action avoids any same-day tiebreak
        // ambiguity and makes each task's own label unique.
        const specs: [string, number][] = [
          ["compost", -1],
          ["fertilize", 0],
          ["sow", 1],
          ["plant", 2],
          ["collect_seeds", 3],
          ["clear", 4],
        ];
        for (const [actionType, offset] of specs) {
          created.push(
            await createAction(request, {
              action_type: actionType,
              due_date_start: isoDate(-10),
              due_date_end: isoDate(offset),
            }),
          );
        }

        await gotoMobileHome(page);

        // Hero: the overdue "compost" task.
        await expect(page.getByText(/^Compost/)).toBeVisible();
        await expect(page.getByText(new RegExp(`Overdue — was due ${isoDate(-1)}`))).toBeVisible();

        // Secondary: fertilize (due today, not overdue), sow, plant,
        // collect_seeds - 4 tasks.
        await expect(page.getByText(/^Fertilize/)).toBeVisible();
        await expect(page.getByText(new RegExp(`Due by ${isoDate(0)}`))).toBeVisible();
        await expect(page.getByText(/^Sow/)).toBeVisible();
        await expect(page.getByText(/^Plant/)).toBeVisible();
        await expect(page.getByText(/^Collect seeds/)).toBeVisible();

        // Remainder: "clear" is the 6th, collapsed into a single line, not
        // rendered as its own row.
        await expect(page.getByText(/^Clear/)).toHaveCount(0);
        const moreLine = page.getByRole("link", { name: "1 more due — view Agenda" });
        await expect(moreLine).toBeVisible();
        await moreLine.click();
        await expect(page).toHaveURL(/\/agenda$/);
      } finally {
        for (const a of created) await request.delete(`/api/actions/${a.id}`).catch(() => {});
      }
    });
  });

  test("'Mark done' on a non-harvest task completes it optimistically, and Undo reverts it", async ({ page, request }) => {
    let action: { id: number } | undefined;
    await withClearedActionableNow(request, async () => {
      try {
        action = await createAction(request, {
          action_type: "prepare_bed",
          due_date_start: isoDate(-5),
          due_date_end: isoDate(0),
        });

        await gotoMobileHome(page);
        await expect(page.getByText(/^Prepare bed/)).toBeVisible();

        await page.getByRole("button", { name: "Mark done" }).click();

        // Optimistic removal - the task disappears immediately, and since
        // it was the only one, the empty state takes over.
        await expect(page.getByText("All caught up — nothing urgent right now.")).toBeVisible();

        await expect
          .poll(async () => (await (await request.get(`/api/actions/${action!.id}`)).json()).status, {
            message: "Mark done never persisted a completed status",
          })
          .toBe("completed");

        // Undo reverts it - reappears in the list and status goes back to
        // pending.
        const status = page.locator('[role="status"]');
        await expect(status).toBeVisible();
        await status.getByRole("button", { name: "Undo" }).click();

        await expect
          .poll(async () => (await (await request.get(`/api/actions/${action!.id}`)).json()).status, {
            message: "Undo never reverted the action back to pending",
          })
          .toBe("pending");
        await expect(page.getByText(/^Prepare bed/)).toBeVisible();
      } finally {
        if (action) await request.delete(`/api/actions/${action.id}`).catch(() => {});
      }
    });
  });

  test("a harvest-type hero task has no 'Mark done' shortcut - only 'Log harvest', routing to the detail page", async ({
    page,
    request,
  }) => {
    let action: { id: number } | undefined;
    await withClearedActionableNow(request, async () => {
      try {
        action = await createAction(request, {
          action_type: "harvest",
          due_date_start: isoDate(-5),
          due_date_end: isoDate(0),
        });

        await gotoMobileHome(page);
        await expect(page.getByText(/^Harvest/)).toBeVisible();
        await expect(page.getByRole("button", { name: "Mark done" })).toHaveCount(0);

        const logHarvestLink = page.getByRole("link", { name: "Log harvest" });
        await expect(logHarvestLink).toBeVisible();
        await logHarvestLink.click();
        await expect(page).toHaveURL(new RegExp(`/tasks/${action!.id}$`));
      } finally {
        if (action) await request.delete(`/api/actions/${action.id}`).catch(() => {});
      }
    });
  });

  test("a single actionable task renders the hero alone - no secondary list, no 'N more' line - and its own link tap-through works", async ({
    page,
    request,
  }) => {
    let action: { id: number } | undefined;
    await withClearedActionableNow(request, async () => {
      try {
        action = await createAction(request, {
          action_type: "sow",
          due_date_start: isoDate(-2),
          due_date_end: isoDate(1),
        });

        await gotoMobileHome(page);
        await expect(page.getByText(/^Sow/)).toBeVisible();
        await expect(page.getByText(/ more due — view Agenda/)).toHaveCount(0);

        await page.getByText(/^Sow/).click();
        await expect(page).toHaveURL(new RegExp(`/tasks/${action!.id}$`));
      } finally {
        if (action) await request.delete(`/api/actions/${action.id}`).catch(() => {});
      }
    });
  });

  test("a task the user just snoozed is excluded from the hero/secondary selection (#230/#231 cross-reference)", async ({
    page,
    request,
  }) => {
    let snoozed: { id: number } | undefined;
    let other: { id: number } | undefined;
    await withClearedActionableNow(request, async () => {
      try {
        // The snoozed task would otherwise win the urgency sort (due
        // yesterday, more urgent than the other task due today) - if
        // snooze exclusion weren't applied, it would incorrectly still be
        // the hero.
        snoozed = await createAction(request, {
          action_type: "compost",
          due_date_start: isoDate(-5),
          due_date_end: isoDate(-1),
          snoozed_until: isoDate(3),
        });
        other = await createAction(request, {
          action_type: "sow",
          due_date_start: isoDate(-5),
          due_date_end: isoDate(0),
        });

        await gotoMobileHome(page);
        await expect(page.getByText(/^Sow/)).toBeVisible();
        await expect(page.getByText(/^Compost/)).toHaveCount(0);
      } finally {
        if (snoozed) await request.delete(`/api/actions/${snoozed.id}`).catch(() => {});
        if (other) await request.delete(`/api/actions/${other.id}`).catch(() => {});
      }
    });
  });
});
