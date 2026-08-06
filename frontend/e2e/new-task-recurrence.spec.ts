import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #227 ("Manually-created recurring/repeating
 * tasks - frontend") - the implementer's own outcome comment verified the
 * New-task form on desktop, field persistence, and the next-occurrence link
 * appearing live after completing a recurring task. Not explicitly
 * mentioned: the ticket's own step 4 (a *non*-recurring task's completion
 * produces no such link) or step 6 (the entry point is reachable from the
 * mobile route, not just desktop) - both are this spec's main net-new
 * coverage, alongside repeatable coverage of the rest.
 *
 * Every `NewTaskDialog.tsx` field is looked up by its own explicit `id`
 * (`#new-task-field-*`), not `getByLabel` - several of this dialog's labels
 * carry a `FieldHint` tooltip trigger whose own `aria-label` (the hint copy)
 * happens to substring-match the field's own label text (e.g. "Bed
 * (optional)"'s hint text itself contains the word "bed"), which makes a
 * non-exact `getByLabel` genuinely ambiguous - `id` sidesteps that whole
 * class of collision.
 */

async function createBed(request: APIRequestContext, name: string): Promise<{ id: number }> {
  const res = await request.post("/api/beds", {
    data: { name, border_geometry: { type: "rectangle", x: 200, y: 200, width: 100, height: 100, rotation: 0 } },
  });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

/** #29's Calendar rewrite made Month the default `/agenda` view - the
 * day-cell/list assertions this spec makes are List mode's own shape, same
 * reasoning `task-agenda-view.spec.ts` documents for its own identical
 * switch. */
async function gotoAgendaListView(page: Page): Promise<void> {
  await page.goto("/agenda");
  await dismissOnboardingIfPresent(page);
  await page.getByRole("radio", { name: "List" }).click();
}

/** Filters by both `bed_id` and `due_date_start` (not `bed_id` alone) - a
 * freshly created bed can, independently of anything this spec does,
 * acquire its own background-generated task (e.g. a routine compost-check
 * reminder due today) from this app's own scheduled generation logic,
 * which would otherwise collide with a same-bed manually-created task in a
 * `bed_id`-only filter. Pinning to the specific far-future `dueDate` this
 * spec always uses (`nextYear`) reliably isolates just the task this spec
 * itself created. */
async function actionsByBed(request: APIRequestContext, bedId: number, dueDateStart?: string) {
  const all = (await (await request.get("/api/actions")).json()) as {
    id: number;
    bed_id: number | null;
    due_date_start: string | null;
  }[];
  return all.filter((a) => a.bed_id === bedId && (dueDateStart === undefined || a.due_date_start === dueDateStart));
}

async function openNewTaskDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "New task" }).click();
  return page.getByRole("dialog");
}

async function fillOneOffTask(dialog: Locator, actionType: string, bedId: number, dueDate: string): Promise<void> {
  await dialog.locator("#new-task-field-type").selectOption(actionType);
  await dialog.locator("#new-task-field-bed").selectOption(String(bedId));
  await dialog.locator("#new-task-field-due-start").fill(dueDate);
}

test.describe("New task + manual recurrence (#227)", () => {
  test("creating a one-off task via the New task dialog makes it appear in the agenda", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E New Task Bed ${stamp}`);
    const nextYear = new Date().getFullYear() + 5;
    const dueDate = `${nextYear}-04-10`;

    try {
      await gotoAgendaListView(page);

      const dialog = await openNewTaskDialog(page);
      await fillOneOffTask(dialog, "prepare_bed", bed.id, dueDate);
      await dialog.locator("#new-task-field-notes").fill("E2E one-off task");
      await dialog.getByRole("button", { name: "Create" }).click();

      await expect
        .poll(async () => (await actionsByBed(request, bed.id, dueDate)).length, {
          message: "one-off task was never created",
        })
        .toBe(1);
      const created = (await actionsByBed(request, bed.id, dueDate))[0];
      expect((created as unknown as { recurrence_unit: string | null }).recurrence_unit).toBeNull();

      // Appears in the agenda's List view under its own due date, linking
      // through to a real detail page - matched by the unique bed name in
      // its taskLabel composition ("Prepare bed — E2E New Task Bed ...").
      const link = page.getByRole("link", { name: new RegExp(`Prepare bed.*E2E New Task Bed ${stamp}`) });
      await expect(link).toBeVisible();
    } finally {
      for (const a of await actionsByBed(request, bed.id)) await request.delete(`/api/actions/${a.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });

  test("a recurring task shows its cadence on its detail page; completing it produces a next-occurrence link, unlike a non-recurring task", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bedRecurring = await createBed(request, `E2E Recurring Bed ${stamp}`);
    const bedOneOff = await createBed(request, `E2E OneOff Bed ${stamp}`);
    const nextYear = new Date().getFullYear() + 5;
    const dueDate = `${nextYear}-05-01`;

    try {
      // --- Create the recurring task via the dialog ---
      await gotoAgendaListView(page);
      const dialog1 = await openNewTaskDialog(page);
      await fillOneOffTask(dialog1, "compost", bedRecurring.id, dueDate);
      await dialog1.getByRole("radio", { name: "Repeating" }).click();
      await expect(dialog1.getByRole("radio", { name: "Repeating" })).toHaveAttribute("aria-checked", "true");
      await dialog1.locator("#new-task-field-recurrence-interval").fill("2");
      await dialog1.getByRole("button", { name: "Create" }).click();

      await expect
        .poll(async () => (await actionsByBed(request, bedRecurring.id, dueDate)).length, {
          message: "recurring task was never created",
        })
        .toBe(1);
      const recurringAction = (await actionsByBed(request, bedRecurring.id, dueDate))[0];
      expect((recurringAction as unknown as { recurrence_unit: string }).recurrence_unit).toBe("weekly");
      expect((recurringAction as unknown as { recurrence_interval: number }).recurrence_interval).toBe(2);

      // --- Create the plain one-off comparison task ---
      const dialog2 = await openNewTaskDialog(page);
      await fillOneOffTask(dialog2, "compost", bedOneOff.id, dueDate);
      await dialog2.getByRole("button", { name: "Create" }).click();
      await expect
        .poll(async () => (await actionsByBed(request, bedOneOff.id, dueDate)).length, {
          message: "one-off comparison task was never created",
        })
        .toBe(1);
      const oneOffAction = (await actionsByBed(request, bedOneOff.id, dueDate))[0];

      // --- The recurring task's detail page shows its cadence ---
      await page.goto(`/tasks/${recurringAction.id}`);
      await expect(page.getByText("Repeats every 2 weeks")).toBeVisible();
      await expect(page.getByText("view next occurrence")).toHaveCount(0);

      // --- Marking it complete produces a live next-occurrence link (not
      // just after a reload) ---
      await page.getByRole("button", { name: "Mark complete" }).click();
      await expect(page.getByRole("button", { name: "Mark pending" })).toBeVisible();
      await expect(page.getByRole("link", { name: "view next occurrence" })).toBeVisible();

      // --- The one-off task's detail page shows no recurrence section at
      // all, and completing it produces no next-occurrence link ---
      await page.goto(`/tasks/${oneOffAction.id}`);
      await expect(page.getByText(/^Repeats/)).toHaveCount(0);
      await page.getByRole("button", { name: "Mark complete" }).click();
      await expect(page.getByRole("button", { name: "Mark pending" })).toBeVisible();
      await expect(page.getByText(/^Repeats/)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "view next occurrence" })).toHaveCount(0);
    } finally {
      for (const a of await actionsByBed(request, bedRecurring.id)) await request.delete(`/api/actions/${a.id}`).catch(() => {});
      for (const a of await actionsByBed(request, bedOneOff.id)) await request.delete(`/api/actions/${a.id}`).catch(() => {});
      await request.delete(`/api/beds/${bedRecurring.id}?cascade=true`).catch(() => {});
      await request.delete(`/api/beds/${bedOneOff.id}?cascade=true`).catch(() => {});
    }
  });

  test("the 'New task' entry point is reachable from the mobile agenda route too, not just desktop", async ({ page, request }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Mobile New Task Bed ${stamp}`);
    const nextYear = new Date().getFullYear() + 5;
    const dueDate = `${nextYear}-06-15`;

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/agenda");
      await dismissOnboardingIfPresent(page);

      const newTaskButton = page.getByRole("button", { name: "New task" });
      await expect(newTaskButton).toBeVisible();
      const dialog = await openNewTaskDialog(page);
      await expect(dialog.getByRole("heading", { name: "New task" })).toBeVisible();
      await fillOneOffTask(dialog, "prepare_bed", bed.id, dueDate);
      await dialog.getByRole("button", { name: "Create" }).click();

      await expect
        .poll(async () => (await actionsByBed(request, bed.id, dueDate)).length, {
          message: "task created from the mobile entry point never persisted",
        })
        .toBe(1);
    } finally {
      for (const a of await actionsByBed(request, bed.id)) await request.delete(`/api/actions/${a.id}`).catch(() => {});
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
