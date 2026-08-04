/** Pure date-grid math for `CalendarView` (#29) - Monday-start weeks
 * throughout, matching the rest of this app's date conventions
 * (`plantingLifecycle.ts`'s `todayIsoDate` etc: plain `YYYY-MM-DD` strings,
 * parsed as local midnight via a `T00:00:00` suffix so results never drift
 * with the browser's own timezone). Kept free of any React/query concerns,
 * tested directly like `agendaMonths.ts`/`taskAgenda.ts`'s own siblings. */

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `Date.getDay()` returns 0=Sunday..6=Saturday; this app's calendar grids
 * are Monday-start, so every offset calculation below needs "days since
 * Monday" (0=Monday..6=Sunday) instead. */
function daysSinceMonday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export interface CalendarDay {
  iso: string;
  /** Whether this cell falls within the month the grid was built for, vs.
   * a leading/trailing day from the adjacent month filling out the fixed
   * 6-week grid. */
  inCurrentMonth: boolean;
}

/** The `{ year, month }` (`month` 1-12, matching this app's convention
 * throughout - not JS `Date`'s 0-11) that an ISO date falls in - the
 * inverse of what `monthGridDays` takes, so a caller holding a single
 * `focusDate` string can derive the month to render from it. */
export function isoYearMonth(iso: string): { year: number; month: number } {
  const date = parseIsoDate(iso);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** Always 42 cells (6 full Monday-start weeks) regardless of the target
 * month's own length or which weekday it starts on, so the grid's height
 * stays stable across navigation instead of growing/shrinking month to
 * month. `month` is 1-12. */
export function monthGridDays(year: number, month: number): CalendarDay[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - daysSinceMonday(firstOfMonth));
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({ iso: toIsoDate(day), inCurrentMonth: day.getMonth() === firstOfMonth.getMonth() && day.getFullYear() === firstOfMonth.getFullYear() });
  }
  return days;
}

/** The 7 ISO dates (Monday..Sunday) of the week containing `iso`. */
export function weekDays(iso: string): string[] {
  const date = parseIsoDate(iso);
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday(date));
  return Array.from({ length: 7 }, (_, i) => toIsoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
}

export function isToday(iso: string, todayIso: string): boolean {
  return iso === todayIso;
}

export function addDays(iso: string, n: number): string {
  const date = parseIsoDate(iso);
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));
}

export function addWeeks(iso: string, n: number): string {
  return addDays(iso, n * 7);
}

/** Steps `iso` by `n` calendar months, clamping the day-of-month to the
 * target month's own length (e.g. Jan 31 + 1 month -> Feb 28/29, not an
 * overflow into March) rather than letting `Date`'s own month-overflow
 * rollover silently shift the date forward. */
export function addMonths(iso: string, n: number): string {
  const date = parseIsoDate(iso);
  const day = date.getDate();
  const totalMonths = date.getFullYear() * 12 + date.getMonth() + n;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  return toIsoDate(new Date(targetYear, targetMonth, Math.min(day, daysInTargetMonth)));
}
