import type { Plant, PlantPeriod, SeedInventoryItem } from "@/api/client";
import { monthsInPeriod } from "@/pages/agenda/agendaMonths";

/** The one `PlantPeriod.period_type` code the real plant data actually uses
 * for "seeds need to go in the ground" (see `data/plants/*.json` -
 * "fertilizing"/"harvesting"/"planting"/"sowing" are the only codes in use
 * today) - not a fixed backend enum, so this is a naming-convention
 * assumption rather than something the schema itself guarantees. */
const SOWING_PERIOD_TYPE = "sowing";

export type SeedGuideUrgency = "buy" | "sow" | "ok";

export interface SeedGuideEntry {
  plantSlug: string;
  plantCommonName: string;
  hasStock: boolean;
  urgency: SeedGuideUrgency;
}

/** "Has seeds on hand" - either count or weight recorded, whichever the
 * packet/purchase this row represents actually specifies (see
 * `SeedInventoryItem`'s own doc - the two are alternatives, not both
 * required). */
function hasSeedStock(item: SeedInventoryItem): boolean {
  return (item.quantity_seeds ?? 0) > 0 || (item.weight_grams ?? 0) > 0;
}

/** Whether any of a plant's sowing periods covers the reference month or
 * the very next one - a simple "coming up soon" check at the same
 * month-only granularity `PlantPeriod` itself stores (there's no
 * day-precision window to check more finely against). */
export function isSowingApproaching(periods: PlantPeriod[], referenceMonth: number): boolean {
  const nextMonth = (referenceMonth % 12) + 1;
  return periods
    .filter((p) => p.period_type === SOWING_PERIOD_TYPE)
    .some((p) => {
      const covered = monthsInPeriod(p.start_month, p.end_month);
      return covered.includes(referenceMonth) || covered.includes(nextMonth);
    });
}

/** One entry per seed inventory row, flagging whether it's worth surfacing
 * on the buying guide right now: `"buy"` when its sowing window is
 * approaching and there's no stock on hand, `"sow"` when the window is
 * approaching and stock IS on hand (a reminder to actually use it before
 * the window closes), `"ok"` otherwise - callers filter "ok" entries out of
 * the default view (see `SeedGuideView`). */
export function buildSeedGuideEntries(
  items: SeedInventoryItem[],
  plantsBySlug: Map<string, Plant>,
  periodsBySlug: Map<string, PlantPeriod[]>,
  referenceMonth: number,
): SeedGuideEntry[] {
  const entries: SeedGuideEntry[] = [];
  for (const item of items) {
    const plant = plantsBySlug.get(item.plant_slug);
    if (!plant) continue;
    const periods = periodsBySlug.get(item.plant_slug) ?? [];
    const stocked = hasSeedStock(item);
    const approaching = isSowingApproaching(periods, referenceMonth);
    const urgency: SeedGuideUrgency = approaching ? (stocked ? "sow" : "buy") : "ok";
    entries.push({ plantSlug: plant.slug, plantCommonName: plant.common_name, hasStock: stocked, urgency });
  }
  return entries;
}
