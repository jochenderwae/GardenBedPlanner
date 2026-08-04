import type { Action, Bed, Plant, Planting, PlantPeriod } from "@/api/client";

/** A calendar year the timeline can display a Gantt row/swimlane for. */
export type TimelineYear = number;

/** Every distinct calendar year the garden's own planting *history* touches
 * (#180's "actuals, not planning intent" framing - `planted_date`/
 * `removed_date`, never `GardenPlan.year`), sorted ascending, always
 * including the current year even for a brand-new garden with no dated
 * plantings yet (so the year selector is never empty). A planting missing
 * one or both dates only contributes whatever year(s) it does have on
 * record - a planting with neither date at all contributes nothing here
 * (it still renders in whichever year is selected, per
 * `plantingOverlapsYear`'s own "no date = always present" rule below, it
 * just doesn't drive which years appear in the selector). */
export function timelineYears(plantings: Planting[], todayIsoDate: string): TimelineYear[] {
  const years = new Set<number>([Number(todayIsoDate.slice(0, 4))]);
  for (const planting of plantings) {
    if (planting.planted_date) years.add(Number(planting.planted_date.slice(0, 4)));
    if (planting.removed_date) years.add(Number(planting.removed_date.slice(0, 4)));
  }
  return [...years].sort((a, b) => a - b);
}

/** Whether a planting belongs on the selected year's timeline row set - it
 * overlaps the year at all, not just "was planted exactly in this year"
 * (a planting from last year that's still in the ground, or one removed
 * partway through this year, both still belong). Missing `planted_date`/
 * `removed_date` reads as "no lower/upper bound" respectively, same
 * open-ended convention `isPlantingActiveAsOf` already uses elsewhere. */
export function plantingOverlapsYear(planting: Planting, year: TimelineYear): boolean {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (planting.planted_date && planting.planted_date > yearEnd) return false;
  if (planting.removed_date && planting.removed_date < yearStart) return false;
  return true;
}

export interface PeriodBarSegment {
  /** 1-12, inclusive - the first month this bar segment covers. */
  startMonth: number;
  /** 1-12, inclusive - the last month this bar segment covers. */
  endMonth: number;
}

/** A `PlantPeriod`'s `start_month`/`end_month` as 1 or 2 non-wrapping
 * segments a Gantt bar can actually render (`grid-column` placement can't
 * span "Nov through Feb" as a single contiguous range within one calendar
 * year's 12 columns) - a period that wraps the year boundary
 * (`start_month > end_month`, e.g. a winter-sowing window `11 -> 2`) splits
 * into a Nov-Dec segment and a Jan-Feb segment, both drawn on the same row.
 * A non-wrapping period is always exactly one segment. Mirrors
 * `agendaMonths.ts`'s `monthsInPeriod` wraparound handling, just returning
 * contiguous ranges instead of an expanded list of every individual month. */
export function periodBarSegments(startMonth: number, endMonth: number): PeriodBarSegment[] {
  if (startMonth <= endMonth) return [{ startMonth, endMonth }];
  return [
    { startMonth, endMonth: 12 },
    { startMonth: 1, endMonth },
  ];
}

/** A single day's position within its own calendar month, as a 0-1 fraction
 * of that month's own width - lets a task diamond land at the right spot
 * *inside* its month's grid column (e.g. a July 20 due date sits toward the
 * right edge of the July column) instead of every task in the same month
 * collapsing onto the same point. */
export function dayFractionInMonth(isoDate: string): number {
  const [, monthStr, dayStr] = isoDate.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  const daysInMonth = new Date(Date.UTC(Number(isoDate.slice(0, 4)), month, 0)).getUTCDate();
  // Centered within its own day-slot (day 1 of 31 sits just after the
  // column's left edge, not exactly on it) rather than a raw day/daysInMonth
  // fraction, which would place day 1 flush against the previous month's
  // boundary line.
  return (day - 0.5) / daysInMonth;
}

/** Calendar-week bucket (1-53, simple `floor(dayOfYear / 7)`, not true ISO
 * 8601 week numbering - overkill precision for a single home garden's
 * season overview) a date falls in, for the timeline's Week granularity
 * toggle. */
export function weekOfYear(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const start = Date.UTC(year, 0, 1);
  const [, m, d] = isoDate.split("-").map(Number);
  const current = Date.UTC(year, m - 1, d);
  const dayOfYear = Math.round((current - start) / (1000 * 60 * 60 * 24));
  return Math.floor(dayOfYear / 7) + 1;
}

/** A day's position within its own calendar week, as a 0-1 fraction -
 * the Week-granularity mirror of `dayFractionInMonth`. */
export function dayFractionInWeek(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const start = Date.UTC(year, 0, 1);
  const [, m, d] = isoDate.split("-").map(Number);
  const current = Date.UTC(year, m - 1, d);
  const dayOfYear = Math.round((current - start) / (1000 * 60 * 60 * 24));
  return ((dayOfYear % 7) + 0.5) / 7;
}

/** The first/last calendar week (see `weekOfYear`) touched by a given
 * month, for rendering a `PlantPeriod` bar segment at Week granularity -
 * `periodBarSegments`'s own month-granularity segments still apply first
 * (a period still splits at the year boundary the same way), this just
 * re-expresses one segment's start/end month as start/end week. */
export function weekRangeForMonths(year: TimelineYear, startMonth: number, endMonth: number): { startWeek: number; endWeek: number } {
  const firstDay = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const lastDayOfMonth = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const lastDay = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`;
  return { startWeek: weekOfYear(firstDay), endWeek: weekOfYear(lastDay) };
}

/** Every `PlantPeriod` on file for one plant slug, sorted so a row's bars
 * always stack in the same order regardless of API response order (a
 * genuine visual-stability concern once multiple period types can overlap
 * in time on one row - see `TimelineView.tsx`'s per-period-type sub-lanes). */
export function periodsForPlant(periods: PlantPeriod[], plantSlug: string): PlantPeriod[] {
  return periods.filter((p) => p.plant_slug === plantSlug).sort((a, b) => a.period_type.localeCompare(b.period_type));
}

/** An action counts as "belonging to" a given `(bed, plant)` Gantt row when
 * it targets that same bed *and* plant (`Action` has no direct
 * `planting_id` FK - see `backend/app/models/action.py`'s own doc on why -
 * so this is the best available match, per #182's own technical analysis).
 * Named after the row it feeds (not `actionsForPlanting`, its pre-#233
 * name) since a row now groups every `Planting` sharing that `(bed_id,
 * plant_slug)` pair rather than representing exactly one - this always only
 * read `.bed_id`/`.plant_slug` off its argument anyway, never anything
 * planting-instance-specific. */
export function actionsForRow(actions: Action[], bedId: number, plantSlug: string): Action[] {
  return actions.filter((a) => a.bed_id === bedId && a.plant_slug === plantSlug);
}

/** Bed-scoped tasks with no specific plant attached (`prepare_bed`,
 * `compost`, ...) - the per-bed swimlane rows below the per-crop rows. */
export function actionsForBedOnly(actions: Action[], bedId: number): Action[] {
  return actions.filter((a) => a.bed_id === bedId && !a.plant_slug);
}

/** Whether an action has a real due date to plot at all - a manually-
 * created task with no computed window (e.g. `thin`, see
 * `task_generation.py`'s own note) has nothing to place on the timeline,
 * same exclusion `taskAgenda.ts`'s `taskDueDateKey` already applies. */
export function actionDueDate(action: Action): string | null {
  return action.due_date_end ?? action.due_date_start ?? null;
}

/** Every distinct bed id referenced by at least one bed-only action within
 * the given set - drives which bed swimlane rows actually render (a bed
 * with no bed-level tasks this year doesn't get an empty row). */
export function bedIdsWithBedOnlyActions(actions: Action[]): Set<number> {
  const ids = new Set<number>();
  for (const a of actions) {
    if (a.bed_id != null && !a.plant_slug) ids.add(a.bed_id);
  }
  return ids;
}

/** Every distinct `(bed_id, plant_slug)` pair with 1+ `Planting`s overlapping
 * the selected year - each becomes one Gantt row (#233), grouping every
 * individually-placed planting of the same species in the same bed onto one
 * row instead of one row per `Planting` (the "6 rows of acorn squash"
 * clutter this ticket fixes). Per-bed, not garden-wide - the same species in
 * two different beds still gets two separate rows (settled design decision,
 * see the ticket body's own "garden-wide grouping was considered and
 * rejected" note: it would need a bed-count subtitle and per-action bed
 * attribution just to keep saying which bed a mark belongs to, for no real
 * benefit at this app's scale). `plantings` is sorted by `planted_date`
 * ascending (an unset date sorts first, treated as "earliest/unknown"
 * rather than pushed to the end) so a row's own detail panel always lists
 * them in a stable, chronological order. Sorted by plant common name then
 * bed name for the row order itself, unchanged from before. Plantings that
 * don't resolve to a known `Bed`/`Plant` (stale FK, still-loading query) are
 * skipped rather than rendered with placeholder text. */
export interface TimelineRow {
  plantings: Planting[];
  plant: Plant;
  bed: Bed;
}

export function timelineRows(
  plantings: Planting[],
  year: TimelineYear,
  plantsBySlug: Map<string, Plant>,
  bedsById: Map<number, Bed>,
): TimelineRow[] {
  const groups = new Map<string, { plant: Plant; bed: Bed; plantings: Planting[] }>();
  for (const planting of plantings) {
    if (!plantingOverlapsYear(planting, year)) continue;
    const plant = plantsBySlug.get(planting.plant_slug);
    const bed = bedsById.get(planting.bed_id);
    if (!plant || !bed) continue;
    const key = `${planting.bed_id}::${planting.plant_slug}`;
    const group = groups.get(key);
    if (group) group.plantings.push(planting);
    else groups.set(key, { plant, bed, plantings: [planting] });
  }

  const rows: TimelineRow[] = [...groups.values()].map(({ plant, bed, plantings: groupPlantings }) => ({
    plant,
    bed,
    plantings: [...groupPlantings].sort((a, b) => (a.planted_date ?? "").localeCompare(b.planted_date ?? "")),
  }));
  rows.sort((a, b) => a.plant.common_name.localeCompare(b.plant.common_name) || a.bed.name.localeCompare(b.bed.name));
  return rows;
}
