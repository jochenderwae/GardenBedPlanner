import type { Bed, Plant, Planting, PlantPeriod } from "@/api/client";

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

export interface AgendaEntry {
  month: number;
  plantSlug: string;
  plantCommonName: string;
  periodTypeCode: string;
  periodTypeLabel: string;
  bedId: number;
  bedName: string;
}

/** Builds one `AgendaEntry` per (active planting x its plant's period x
 * month that period covers) - the actual "what's due when across the whole
 * garden" view this backlog item asks for. Only plantings still in the
 * ground (`removed_date` unset) are considered, since a removed planting's
 * species-level sow/harvest calendar isn't actionable anymore. Callers
 * group the result by `month` for a month-by-month display (see
 * `groupByMonth`). */
export function buildAgendaEntries(
  plantings: Planting[],
  plantsBySlug: Map<string, Plant>,
  periods: PlantPeriod[],
  bedsById: Map<number, Bed>,
): AgendaEntry[] {
  const entries: AgendaEntry[] = [];
  const activePlantings = plantings.filter((p) => !p.removed_date);

  // One pass per distinct plant referenced by an active planting (rather
  // than per-planting x per-period-row) so a plant placed several times in
  // the garden (e.g. two tomato plantings in different beds) still gets its
  // own entry per bed instead of being silently deduplicated.
  for (const planting of activePlantings) {
    const plant = plantsBySlug.get(planting.plant_slug);
    const bed = bedsById.get(planting.bed_id);
    if (!plant || !bed) continue;

    const plantPeriods = periods.filter((period) => period.plant_slug === planting.plant_slug);
    for (const period of plantPeriods) {
      for (const month of monthsInPeriod(period.start_month, period.end_month)) {
        entries.push({
          month,
          plantSlug: plant.slug,
          plantCommonName: plant.common_name,
          periodTypeCode: period.period_type,
          periodTypeLabel: period.period_type,
          bedId: bed.id ?? planting.bed_id,
          bedName: bed.name,
        });
      }
    }
  }
  return entries;
}

/** Applies human-readable `PeriodType.description` labels (falling back to
 * the raw code when a type has none) - kept as a separate pass over
 * `buildAgendaEntries`'s output rather than baked into it, so that function
 * stays testable without needing a `PeriodType` fixture too. */
export function applyPeriodTypeLabels(
  entries: AgendaEntry[],
  periodTypeLabelsByCode: Map<string, string>,
): AgendaEntry[] {
  return entries.map((entry) => ({
    ...entry,
    periodTypeLabel: periodTypeLabelsByCode.get(entry.periodTypeCode) || entry.periodTypeCode,
  }));
}

/** Groups agenda entries by month (1-12) for a month-by-month rendering,
 * sorted within each month by plant name for a stable, scannable order. */
export function groupByMonth(entries: AgendaEntry[]): Map<number, AgendaEntry[]> {
  const byMonth = new Map<number, AgendaEntry[]>();
  for (let month = 1; month <= 12; month++) byMonth.set(month, []);
  for (const entry of entries) {
    byMonth.get(entry.month)?.push(entry);
  }
  for (const monthEntries of byMonth.values()) {
    monthEntries.sort((a, b) => a.plantCommonName.localeCompare(b.plantCommonName));
  }
  return byMonth;
}
