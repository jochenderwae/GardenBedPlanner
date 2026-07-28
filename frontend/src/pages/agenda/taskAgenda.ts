import type { Action, ActionType } from "@/api/client";

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
