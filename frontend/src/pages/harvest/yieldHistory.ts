import type { HarvestLog, Planting } from "@/api/client";

/** A year's combined amount for one distinct unit actually logged that
 * year - kept per-unit rather than one blind sum, since `yield_unit` is
 * free text (kg, count, bunches, ...) and summing across incompatible
 * units would misrepresent the total rather than aggregate it. */
export interface YieldUnitTotal {
  unit: string;
  total: number;
}

export interface YieldYearGroup {
  year: number;
  unitTotals: YieldUnitTotal[];
  /** Every log for this plant in this year, most-recent-first - carries
   * quality/notes through to the view, per the ticket's own "surface the
   * quality/notes fields alongside" requirement. */
  entries: HarvestLog[];
}

export interface YieldPlantGroup {
  plantSlug: string;
  /** Sorted most-recent-year-first. A plant with only one year of data is
   * a completely normal one-element array here - callers shouldn't (and
   * this module doesn't) compute or imply any trend from it. */
  years: YieldYearGroup[];
}

/** Resolves a `HarvestLog`'s own plant - `HarvestLog` only carries
 * `planting_id`, not `plant_slug` directly (see `harvest_log.py`'s own
 * doc on why: a per-crop yield history needs the specific `Planting`, not
 * just a bed). `null` when the referenced planting can't be found (a
 * genuine data inconsistency - deleting a Planting doesn't cascade-delete
 * its HarvestLogs, by design, same as every other satellite table in this
 * app) - callers skip these rather than showing them under a misleading
 * "unknown plant" bucket. */
export function plantSlugForLog(log: HarvestLog, plantingsById: Map<number, Planting>): string | null {
  return plantingsById.get(log.planting_id)?.plant_slug ?? null;
}

/** Groups every `HarvestLog` by plant, then by the year its `harvest_date`
 * falls in - the "which crops produced well last year" rollup this
 * ticket's own source (Dave's "evaluate last year" journey step) asks
 * for. Plant group order is by `plantSlug` (callers join `Plant.
 * common_name` afterward and re-sort by that - this module has no `Plant`
 * data of its own to sort by). */
export function buildYieldHistory(logs: HarvestLog[], plantingsById: Map<number, Planting>): YieldPlantGroup[] {
  const byPlant = new Map<string, HarvestLog[]>();
  for (const log of logs) {
    const slug = plantSlugForLog(log, plantingsById);
    if (!slug) continue;
    const list = byPlant.get(slug) ?? [];
    list.push(log);
    byPlant.set(slug, list);
  }

  const groups: YieldPlantGroup[] = [];
  for (const [plantSlug, plantLogs] of byPlant) {
    const byYear = new Map<number, HarvestLog[]>();
    for (const log of plantLogs) {
      const year = Number(log.harvest_date.slice(0, 4));
      const list = byYear.get(year) ?? [];
      list.push(log);
      byYear.set(year, list);
    }

    const years: YieldYearGroup[] = [...byYear.entries()]
      .map(([year, yearLogs]) => {
        const unitTotalsByUnit = new Map<string, number>();
        for (const log of yearLogs) {
          if (log.yield_amount == null) continue;
          const unit = log.yield_unit?.trim() || "(no unit)";
          unitTotalsByUnit.set(unit, (unitTotalsByUnit.get(unit) ?? 0) + log.yield_amount);
        }
        return {
          year,
          unitTotals: [...unitTotalsByUnit.entries()].map(([unit, total]) => ({ unit, total })),
          entries: [...yearLogs].sort((a, b) => b.harvest_date.localeCompare(a.harvest_date)),
        };
      })
      .sort((a, b) => b.year - a.year);

    groups.push({ plantSlug, years });
  }
  groups.sort((a, b) => a.plantSlug.localeCompare(b.plantSlug));
  return groups;
}
