/** Small month-number utilities, originally written for the now-removed
 * `AgendaView.tsx` (superseded by `CalendarView.tsx`, #29) but kept here -
 * `MONTH_NAMES` and `monthsInPeriod` turned out to be genuine shared
 * dependencies (`plant-detail/SatelliteSections.tsx`'s period display,
 * `seed-guide/seedGuide.ts`'s `buildSeedGuideEntries`), not private helpers
 * of the view that used to live in this file - deleting the whole module
 * alongside `AgendaView.tsx` would have broken both of those unrelated
 * features, so only the `AgendaView`-only exports (`AgendaEntry`,
 * `buildAgendaEntries`, `applyPeriodTypeLabels`, `groupByMonth`) were
 * removed. */

/** Month numbers this app uses throughout are 1-12 (matching `PlantPeriod`'s
 * own `start_month`/`end_month`), not JS `Date`'s 0-11. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Every month (1-12) a period covers, handling a range that wraps across
 * the year boundary (e.g. a winter-sowing period `start_month: 11,
 * end_month: 2` covers Nov, Dec, Jan, Feb) the same way a plain
 * `start <= month <= end` check can't. */
export function monthsInPeriod(startMonth: number, endMonth: number): number[] {
  const months: number[] = [];
  if (startMonth <= endMonth) {
    for (let m = startMonth; m <= endMonth; m++) months.push(m);
  } else {
    for (let m = startMonth; m <= 12; m++) months.push(m);
    for (let m = 1; m <= endMonth; m++) months.push(m);
  }
  return months;
}
