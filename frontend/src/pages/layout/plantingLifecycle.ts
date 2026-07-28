import type { Planting } from "@/api/client";

/** Splits a `YYYY-MM-DD` string into `[year, monthIndex0, day]`, matching
 * `Date`'s own 0-indexed month - a small shared step for the UTC-midnight
 * parsing every date-arithmetic helper below uses (see `daysBetweenIsoDates`'s
 * doc for why UTC, not local time). */
function splitIsoDate(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m - 1, d];
}

/** Today's date as a local `YYYY-MM-DD` string - matches the plain date
 * strings `Planting.planted_date`/`removed_date` and every `<Input
 * type="date">` in this app already use, so it can be compared or assigned
 * directly without parsing either side through `Date`. */
export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calendar days between two `YYYY-MM-DD` strings (`toIso` - `fromIso`),
 * positive when `toIso` is later. Parses both as UTC midnight so a DST
 * transition in the browser's own local timezone can never shift the count
 * by a day. */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const from = Date.UTC(...splitIsoDate(fromIso));
  const to = Date.UTC(...splitIsoDate(toIso));
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/** `iso` shifted by `days` (negative moves earlier) - the inverse of
 * `daysBetweenIsoDates`, used to build the date-scrubber's own scrubbable
 * range and to jump the "Today" control by a fixed offset. */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, m, d] = splitIsoDate(iso);
  const date = new Date(Date.UTC(y, m, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whether a planting is actually "in the ground" as of `asOfDate` -
 * `planted_date`/`removed_date` are both nullable (plenty of plantings,
 * especially older/imported ones, don't record an exact planted date at
 * all), so a missing field never excludes a planting on its own - only an
 * *explicit* date on the wrong side of `asOfDate` does. This is what makes
 * `removed_date` genuinely mean "history" rather than a boolean flag (#180):
 * a planting with a *future* `removed_date` is still active today, and one
 * with a past `removed_date` is not, regardless of whether it's ever been
 * unset. */
export function isPlantingActiveAsOf(planting: Planting, asOfDate: string): boolean {
  if (planting.planted_date && planting.planted_date > asOfDate) return false;
  if (planting.removed_date && planting.removed_date <= asOfDate) return false;
  return true;
}

/** Within this many days of its own `removed_date`, a still-active planting
 * reads as "leaving soon" on the Edit tab's canvas (reduced opacity, on top
 * of the dashed stroke every future-dated removal already gets) rather than
 * just "scheduled". A tunable starting point per the user's own sign-off on
 * #180's canvas treatment, explicitly flagged for future re-evaluation, not
 * a hard requirement. */
export const LEAVING_SOON_THRESHOLD_DAYS = 14;

export type RemovalVisualState = "normal" | "scheduled" | "leaving-soon";

/** Derives a planting's Edit-tab visual state purely from `removed_date` vs.
 * `asOfDate` - no new persisted field (#180: "still growing" / "scheduled to
 * leave" / "already gone" are all derived client-side). Only meaningful for
 * a planting that already passed `isPlantingActiveAsOf`; an already-removed
 * planting isn't rendered at all; this doesn't need to special-case it. */
export function removalVisualState(planting: Planting, asOfDate: string): RemovalVisualState {
  if (!planting.removed_date) return "normal";
  const daysUntil = daysBetweenIsoDates(asOfDate, planting.removed_date);
  return daysUntil <= LEAVING_SOON_THRESHOLD_DAYS ? "leaving-soon" : "scheduled";
}

/** "Scheduled to be cleared in N days" copy for `PlantingPanel`'s own
 * `removed_date` field (#180) - `null` when no `removed_date` is set at all.
 * Handles the past-relative-to-`asOfDate` case (a user can type any date
 * directly into the field, including one already in the past) with its own
 * past-tense phrasing instead of a negative day count. */
export function describeRemovalSchedule(planting: Planting, asOfDate: string): string | null {
  if (!planting.removed_date) return null;
  const days = daysBetweenIsoDates(asOfDate, planting.removed_date);
  if (days > 1) return `Scheduled to be cleared in ${days} days`;
  if (days === 1) return "Scheduled to be cleared tomorrow";
  if (days === 0) return "Scheduled to be cleared today";
  const daysAgo = -days;
  return daysAgo === 1 ? "Cleared 1 day ago" : `Cleared ${daysAgo} days ago`;
}

/** Buffer (days) the View tab's date scrubber extends past the earliest/
 * latest date actually present in the garden's plantings, so "today" (and a
 * bit of headroom either side of it) is always reachable even for a garden
 * with only one tightly-dated planting on record. */
const SCRUBBER_PAST_BUFFER_DAYS = 30;
const SCRUBBER_FUTURE_BUFFER_DAYS = 180;

/** The View tab's scrubbable `[min, max]` window (#180) - spans every
 * `planted_date`/`removed_date` actually on record (a garden's real history
 * can span several years, not just "this calendar year") plus a fixed
 * buffer on each end, always including `today`. */
export function defaultScrubberRange(plantings: Planting[], today: string): { min: string; max: string } {
  const dates = plantings.flatMap((p) => [p.planted_date, p.removed_date]).filter((d): d is string => !!d);
  dates.push(today);
  const earliest = dates.reduce((min, d) => (d < min ? d : min), today);
  const latest = dates.reduce((max, d) => (d > max ? d : max), today);
  return {
    min: addDaysToIsoDate(earliest, -SCRUBBER_PAST_BUFFER_DAYS),
    max: addDaysToIsoDate(latest, SCRUBBER_FUTURE_BUFFER_DAYS),
  };
}
