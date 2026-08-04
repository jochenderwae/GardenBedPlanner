import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import type { Plant, PlantDetail as PlantDetailData } from "@/api/client";

/** Cross-links a cultivar to its parent species and/or a parent species to
 * its own cultivars (#236) - `parent_plant_slug` already existed as data
 * (`backend/app/models/plant.py`, self-referencing FK, #110/#64) but wasn't
 * surfaced anywhere in the frontend before this ticket, only consumed by
 * the generated `schema.d.ts`. Mirrors `PlantsDatabase.tsx`'s own new
 * third-tier grouping of the same relationship. `allPlants` is the
 * already-loaded full plant list `PlantDetail.tsx` fetches for
 * `CompanionsSection`'s own cross-plant lookups - no dedicated "list
 * children of this plant" API route exists, and doesn't need to for a
 * client-side filter over data already in memory. Read-only: no editable
 * field for changing which species a plant belongs to exists in
 * `FieldInput`'s `SCALAR_FIELDS` today, and this ticket doesn't ask for
 * one. Renders nothing at all - not an empty placeholder - for a plant with
 * neither a parent nor any cultivars. */
export function LineageSection({ plant, allPlants }: { plant: PlantDetailData; allPlants: Plant[] }) {
  const parent = plant.parent_plant_slug ? allPlants.find((p) => p.slug === plant.parent_plant_slug) : null;
  const cultivars = allPlants
    .filter((p) => p.parent_plant_slug === plant.slug)
    .sort((a, b) => a.common_name.localeCompare(b.common_name));

  if (!parent && cultivars.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      {parent && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Parent plant</span>
          <Link to={`/plants/${parent.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {parent.common_name}
          </Link>
        </div>
      )}
      {cultivars.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold">Cultivars ({cultivars.length})</h2>
          <ul className="flex flex-col gap-1">
            {cultivars.map((cultivar) => (
              <li key={cultivar.slug}>
                <Link to={`/plants/${cultivar.slug}`} className="text-sm underline-offset-2 hover:underline">
                  {cultivar.common_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
