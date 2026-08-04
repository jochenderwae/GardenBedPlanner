import type { Action, Planting } from "@/api/client";

export interface HarvestPlantingResolution {
  planting: Planting | null;
  matchCount: number;
}

/** Resolves which `Planting` a `harvest` `Action` refers to (#221) - `Action`
 * has no direct `planting_id` FK (see `backend/app/models/action.py`'s own
 * doc on why), only `bed_id`/`plant_slug`, so this matches the currently-
 * active planting in that bed for that plant (`removed_date == null`) -
 * same filtering approach `BedPanel.tsx`'s own "past plantings" history
 * list already uses. `task_generation.py` generates one `harvest` `Action`
 * per `Planting`, so this normally resolves to exactly one match -
 * `matchCount` surfaces the two real degrade states (0 or 2+ matches)
 * rather than silently guessing, per the ticket's own design spec. */
export function resolveHarvestPlanting(plantings: Planting[], action: Action): HarvestPlantingResolution {
  const matches = plantings.filter(
    (p) => p.bed_id === action.bed_id && p.plant_slug === action.plant_slug && p.removed_date == null,
  );
  return { planting: matches.length === 1 ? matches[0] : null, matchCount: matches.length };
}

/** User-facing explanation for why "Log a harvest" is disabled - `null`
 * when there's a real, unambiguous planting to log against. */
export function harvestDisabledReason(matchCount: number): string | null {
  if (matchCount === 0) {
    return "This planting has already been cleared — harvest can't be logged against it anymore.";
  }
  if (matchCount > 1) {
    return "Can't tell which planting this task belongs to — resolve this from the bed's planting list instead.";
  }
  return null;
}
