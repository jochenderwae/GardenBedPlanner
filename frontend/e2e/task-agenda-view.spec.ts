import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #181 ("The agenda view") - no existing e2e
 * spec touched `TaskAgendaView.tsx`/`TaskDetail.tsx` before this. Covers
 * the ticket's own "how to test" steps: day-cells group tasks by due date
 * with each linking through to its own detail page, the detail page shows
 * the task's real data and its mark-complete toggle actually removes it
 * from the agenda (the "pending tasks only" filter), and the view is
 * reachable from both the desktop and mobile route sets.
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

/** #29's Calendar rewrite made Month the default `/agenda` view - this
 * spec's own day-cell/CardTitle assertions are List mode's shape (the
 * former `TaskAgendaView`/`AgendaView` content), so every navigation needs
 * an explicit switch to List before the existing assertions apply. Flagged
 * directly by #29's own implementer outcome comment as a required follow-up
 * for these two specs. */
async function gotoAgendaListView(page: Page): Promise<void> {
  await page.goto("/agenda");
  await dismissOnboardingIfPresent(page);
  await page.getByRole("radio", { name: "List" }).click();
}

test.describe("Task agenda view + task detail page (#181)", () => {
  test("day-cells group tasks by due date, and each links through to a working detail page", async ({
    page,
    request,
  }) => {
    const today = new Date();
    const nextYear = today.getFullYear() + 5; // far enough out not to collide with real/other test data
    const dateA = `${nextYear}-03-15`;
    const dateB = `${nextYear}-03-20`;
    const actionA1 = await createAction(request, "prepare_bed", dateA);
    const actionA2 = await createAction(request, "compost", dateA);
    const actionB = await createAction(request, "harvest", dateB);

    try {
      await gotoAgendaListView(page);

      // The day-cell's own CardTitle (a shadcn Card - renders a plain
      // <div data-slot="card-title">, not a semantic heading role).
      const headingA = page.locator('[data-slot="card-title"]', { hasText: new RegExp(`March 15, ${nextYear}`) });
      const headingB = page.locator('[data-slot="card-title"]', { hasText: new RegExp(`March 20, ${nextYear}`) });
      await expect(headingA).toBeVisible();
      await expect(headingB).toBeVisible();

      // Both dateA tasks are grouped under the same day-cell (Card).
      const cellA = page.locator('[data-slot="card"]').filter({ has: headingA });
      await expect(cellA.getByRole("link", { name: /^Prepare bed/ })).toBeVisible();
      await expect(cellA.getByRole("link", { name: /^Compost/ })).toBeVisible();

      const cellB = page.locator('[data-slot="card"]').filter({ has: headingB });
      await expect(cellB.getByRole("link", { name: /^Harvest/ })).toBeVisible();
      // dateB's cell has exactly its own one task, not dateA's.
      await expect(cellB.getByRole("link", { name: /^Prepare bed/ })).toHaveCount(0);

      // Click through to the detail page.
      await cellB.getByRole("link", { name: /^Harvest/ }).click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${actionB.id}$`));
      await expect(page.getByRole("heading", { name: "Harvest" })).toBeVisible();
      await expect(page.getByText("Pending")).toBeVisible();
      await expect(page.getByText(dateB)).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${actionA1.id}`).catch(() => {});
      await request.delete(`/api/actions/${actionA2.id}`).catch(() => {});
      await request.delete(`/api/actions/${actionB.id}`).catch(() => {});
    }
  });

  test("marking a task complete removes it from the agenda's pending list", async ({ page, request }) => {
    const nextYear = new Date().getFullYear() + 6;
    const dueDate = `${nextYear}-04-10`;
    const action = await createAction(request, "fertilize", dueDate);

    try {
      await page.goto(`/tasks/${action.id}`);
      await expect(page.getByRole("heading", { name: "Fertilize" })).toBeVisible();
      await expect(page.getByText("Pending")).toBeVisible();

      await page.getByRole("button", { name: "Mark complete" }).click();
      // Not a bare `getByText("Completed")` - once `action.completed_date`
      // is set, TaskDetail.tsx renders a second, separate "Completed" `<dt>`
      // field label alongside the status value, making that locator
      // ambiguous. The status field's own "Mark pending" toggle button
      // appearing is the unambiguous signal the status actually flipped.
      await expect(page.getByRole("button", { name: "Mark pending" })).toBeVisible();
      await expect
        .poll(async () => (await (await request.get(`/api/actions/${action.id}`)).json()).status)
        .toBe("completed");

      await gotoAgendaListView(page);
      // Completed tasks aren't shown in the pending-only agenda list.
      await expect(page.getByRole("link", { name: /^Fertilize/ })).toHaveCount(0);

      // Toggling back to pending brings it back.
      await page.goto(`/tasks/${action.id}`);
      await page.getByRole("button", { name: "Mark pending" }).click();
      await expect(page.getByText("Pending")).toBeVisible();
      await gotoAgendaListView(page);
      await expect(page.getByRole("link", { name: new RegExp(`Fertilize`) })).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });

  test("the task agenda is reachable from the mobile route set too", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const nextYear = new Date().getFullYear() + 7;
    const dueDate = `${nextYear}-05-05`;
    const action = await createAction(request, "sow", dueDate);

    try {
      await gotoAgendaListView(page);
      await expect(page.getByRole("link", { name: /^Sow/ })).toBeVisible();
    } finally {
      await request.delete(`/api/actions/${action.id}`).catch(() => {});
    }
  });
});
