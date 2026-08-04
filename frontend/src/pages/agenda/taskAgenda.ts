import type { Action, ActionType, Bed, BedEquipment, Plant } from "@/api/client";

/** Human-readable labels for `ActionType` - no such mapping existed
 * anywhere in the frontend before this (#181 is the first real Action
 * consumer), so this is the one place it's defined; reuse rather than
 * re-deriving from the raw snake_case code at another call site. */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  fertilize: "Fertilize",
  compost: "Compost",
  prepare_bed: "Prepare bed",
  sow: "Sow",
  plant: "Plant",
  install_equipment: "Install equipment",
  remove_equipment: "Remove equipment",
  harvest: "Harvest",
  clear: "Clear",
  collect_seeds: "Collect seeds",
  thin: "Thin",
};

/** The calendar date (`YYYY-MM-DD`) a task's day-cell agenda entry files
 * under - its own due window's "must finish before" end date
 * (`due_date_end`), the same field the backend's own `actionable_now`
 * filter (#192) already prioritizes by (closest deadline first) - not
 * `due_date_start`, which only says when a task's window *opens*, not when
 * it's actually due. A task with no `due_date_end` at all (a manually-
 * created one with no computed window, e.g. `thin` - see
 * `task_generation.py`'s own note on why thinning stays manual) has
 * nothing to file it under, so it's excluded from the day-cell agenda
 * entirely rather than lumped into an "unscheduled" catch-all this ticket
 * doesn't ask for. */
export function taskDueDateKey(action: Action): string | null {
  return action.due_date_end ?? null;
}

/** Groups actions by their own day-cell date key (see `taskDueDateKey`),
 * dropping any with no `due_date_end`. Each day's own list is sorted by
 * action type for a stable, scannable order (mirroring `agendaMonths.ts`'s
 * `groupByMonth` sorting its own per-month entries). */
export function groupActionsByDueDate(actions: Action[]): Map<string, Action[]> {
  const byDate = new Map<string, Action[]>();
  for (const action of actions) {
    const key = taskDueDateKey(action);
    if (!key) continue;
    const list = byDate.get(key) ?? [];
    list.push(action);
    byDate.set(key, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.action_type.localeCompare(b.action_type));
  }
  return byDate;
}

/** Chronologically sorted list of the distinct dates present in a grouped
 * map - `groupActionsByDueDate`'s own `Map` doesn't guarantee insertion
 * order matches date order (actions arrive in whatever order the API
 * returned them), so a caller rendering day-cells in date order needs this
 * rather than iterating the `Map` directly. Plain string sort works
 * because every key is already a zero-padded `YYYY-MM-DD` ISO date. */
export function sortedDueDates(byDate: Map<string, Action[]>): string[] {
  return [...byDate.keys()].sort();
}

/** Closest-deadline-first ordering for a flat (ungrouped) list of actions -
 * the same "urgency" convention the backend's own `actionable_now` filter
 * (#192) sorts by server-side and `groupActionsByDueDate` applies per day,
 * just not scoped to a single day. First consumed by #224's mobile Home
 * tab, which needs one ranked list across every actionable task rather than
 * a day-by-day breakdown. An action with no `due_date_end` at all (a
 * manually-created task with no computed window) sorts last, not first -
 * "no deadline" reads as less urgent than any actual deadline, not more.
 * Ties (including the "no due_date_end" bucket) break by `action_type`
 * alphabetically, mirroring `groupActionsByDueDate`'s own tiebreak. */
export function sortByUrgency(actions: Action[]): Action[] {
  return [...actions].sort((a, b) => {
    const aEnd = a.due_date_end ?? "9999-12-31";
    const bEnd = b.due_date_end ?? "9999-12-31";
    if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
    return a.action_type.localeCompare(b.action_type);
  });
}

/** "Tuesday, July 28, 2026" - day-level, so a locale-aware `Date` format
 * reads better than hand-rolling one the way `agendaMonths.ts`'s
 * month-only `MONTH_NAMES` does (a plain month name has no such
 * locale-formatting ambiguity to begin with). Parsed as local midnight
 * (`T00:00:00`, no timezone suffix) so the displayed date matches the
 * plain `YYYY-MM-DD` string everywhere else in this app, regardless of the
 * browser's own timezone. Originally private to `TaskAgendaView.tsx`;
 * exported here (#29) so `CalendarView.tsx`'s Week/Day cells can reuse the
 * same day-heading format List mode already has, rather than a second
 * copy. */
export function formatDueDateHeading(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** Whether `action`'s reminder is currently suppressed by a snooze (#230/
 * #231) - `snoozed_until` set to today or later. Once that date has passed,
 * this returns `false` again with no manual "unsnooze" step needed
 * anywhere that reads it (mirrors #230's own backend auto-clear
 * reasoning) - every one of this ticket's three call sites (`TaskDetail.tsx`,
 * `TaskAgendaView.tsx`, `MobileHome.tsx`) needs the identical check, defined
 * once here rather than re-derived three times. Snoozing suppresses
 * reminders/Home-tab hero eligibility only, not visibility - a snoozed
 * task still appears normally in the agenda/timeline regardless of what
 * this returns. */
export function isSnoozed(action: Action, todayIso: string): boolean {
  return action.snoozed_until != null && action.snoozed_until >= todayIso;
}

/** "Sow — Tomato (North planter)" - the action type plus whichever of
 * plant/bed/equipment it references, in that order, joined only by the
 * pieces actually present (an action isn't required to reference any of
 * them - see `Action`'s own doc on its four nullable FKs). Originally
 * private to `TaskAgendaView.tsx`; exported here (#29) so `CalendarView`'s
 * Month/Week/Day cells can reuse the same task-label formatting List mode
 * already has, rather than a second copy. */
export function taskLabel(
  action: Action,
  plantsBySlug: Map<string, Plant>,
  bedsById: Map<number, Bed>,
  equipmentById: Map<number, BedEquipment>,
): string {
  const typeLabel = ACTION_TYPE_LABELS[action.action_type] ?? action.action_type;
  const plantLabel = action.plant_slug ? (plantsBySlug.get(action.plant_slug)?.common_name ?? action.plant_slug) : null;
  const bedLabel = action.bed_id != null ? (bedsById.get(action.bed_id)?.name ?? `Bed #${action.bed_id}`) : null;
  const equipmentLabel =
    action.equipment_id != null
      ? (equipmentById.get(action.equipment_id)?.equipment_type ?? `Equipment #${action.equipment_id}`)
      : null;
  const refs = [plantLabel, bedLabel, equipmentLabel].filter((r): r is string => !!r);
  return refs.length > 0 ? `${typeLabel} — ${refs.join(", ")}` : typeLabel;
}
