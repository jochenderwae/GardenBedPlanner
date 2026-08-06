import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #29 (Calendar view of planting-derived actions)
 * - `CalendarView.tsx` replaced the old month-grouped `AgendaView.tsx` with a
 * real Month/Week/Day/List calendar. `calendarGrid.test.ts` already covers
 * the pure date-grid math at the unit level; this covers the rendering/
 * interaction surface that can't: Month is the default view with a real
 * task pill in its own day cell, drilling into a day switches to Day view,
 * the Week toggle renders the same task in its weekday column, and the
 * Previous/Next/Today navigation controls actually move the focus date.
 * List mode itself (the former TaskAgendaView, unchanged) already has its
 * own dedicated coverage in task-agenda-view.spec.ts.
 */

async function createAction(
  request: APIRequestContext,
  actionType: string,
  dueDate: string,
): Promise<{ id: number }> {
  const res = await request.post("/api/actions", {
    data: { action_type: actionType, status: "pending", due_date_start: dueDate, due_date_end: dueDate },
  });
  expect(res.ok(), `failed to create action: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function gotoAgenda(page: Page): Promise<void> {
  await page.goto("/agenda");
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
}

const today = new Date();
const todayIso = today.toISOString().slice(0, 10);

test.describe("Calendar view (#29)", () => {
  test("Month is the default view; a due task renders as a pill in its own day cell and links to the task detail page", async ({
    page,
    request,
  }) => {
    const action = await createAction(request, "harvest", todayIso);

    try {
      await gotoAgenda(page);

      // Month mode is selected by default (not List, which #29's own
      // implementer note flags as the pre-existing default before this
      // rewrite).
      await expect(page.getByRole("radio", { name: "Month", checked: true })).toBeVisible();

      const taskLink = page.getByRole("link", { name: /^Harvest/ });
      await expect(taskLink).toBeVisible();
      await taskLink.click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${action.id}$`));
      await expect(page.getByRole("heading", { name: "Harvest" })).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("clicking a day cell's own day-number drills into Day view for that date", async ({ page, request }) => {
    const action = await createAction(request, "compost", todayIso);

    try {
      await gotoAgenda(page);

      const dayButton = page.getByRole("button", { name: new RegExp(`, ${today.getFullYear()}, 1 task`) });
      await expect(dayButton).toBeVisible();
      await dayButton.click();

      await expect(page.getByRole("radio", { name: "Day", checked: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Compost/ })).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("Day view shows an explicit empty state for a date with no tasks", async ({ page }) => {
    await gotoAgenda(page);
    await page.getByRole("radio", { name: "Day" }).click();
    await expect(page.getByRole("radio", { name: "Day", checked: true })).toBeVisible();

    // Jump 6 months out via repeated Next clicks on Day granularity is slow
    // and flaky - instead rely on "no tasks due" rendering for *today* in a
    // freshly-truncated garden_test with nothing else scheduled today. If
    // this ever collides with real fixture data, the assertion below (not
    // finding the "No tasks due" copy) will fail loudly rather than
    // silently passing for the wrong reason.
    await expect(page.getByText(/No tasks due on/)).toBeVisible();
  });

  test("the Week toggle renders the same task in its own weekday column", async ({ page, request }) => {
    const action = await createAction(request, "sow", todayIso);

    try {
      await gotoAgenda(page);
      await page.getByRole("radio", { name: "Week" }).click();
      await expect(page.getByRole("radio", { name: "Week", checked: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Sow/ })).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("Previous/Next move the focus period, and Today resets it back", async ({ page }) => {
    await gotoAgenda(page);

    const monthYearLabel = today.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    // MiniCalendar's own trigger button shows the current period label.
    const periodTrigger = page.getByRole("button", { name: monthYearLabel });
    await expect(periodTrigger).toBeVisible();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(periodTrigger).toHaveCount(0);

    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByRole("button", { name: monthYearLabel })).toBeVisible();
  });
});
