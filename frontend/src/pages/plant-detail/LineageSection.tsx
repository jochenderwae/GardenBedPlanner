import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { Plant, PlantDetail as PlantDetailData } from "@/api/client";

/** Every other plant whose own `parent_plant_slug` points back at this one
 * (#236) - `parent_plant_slug` already existed as data
 * (`backend/app/models/plant.py`, self-referencing FK, #110/#64) but wasn't
 * surfaced anywhere in the frontend before #236, only consumed by the
 * generated `schema.d.ts`. The *forward* direction (a cultivar's own link
 * back to its parent) moved onto `PlantDetail.tsx`'s identity line as part
 * of #237's layout pass - alongside name/family/genus, not its own separate
 * section, since it's a single identifying fact about the plant rather than
 * a list. This component now only ever renders the reverse direction (a
 * parent species's list of cultivars), which stays list-shaped and so
 * doesn't fit the identity line the same way.
 *
 * `allPlants` is the already-loaded full plant list `PlantDetail.tsx`
 * fetches for `CompanionsSection`'s own cross-plant lookups - no dedicated
 * "list children of this plant" API route exists, and doesn't need to for a
 * client-side filter over data already in memory. Read-only. Wrapped in a
 * `Card`, matching #237's "every satellite section gets a bordered panel"
 * convention even though it isn't one of the ticket's own named 7 - it's
 * the same kind of grouped, optional content. Renders nothing at all - not
 * an empty placeholder/empty Card - for a plant with no cultivars. */
export function LineageSection({ plant, allPlants }: { plant: PlantDetailData; allPlants: Plant[] }) {
  const cultivars = allPlants
    .filter((p) => p.parent_plant_slug === plant.slug)
    .sort((a, b) => a.common_name.localeCompare(b.common_name));

  if (cultivars.length === 0) return null;

  return (
    <Card className="flex flex-col gap-1.5 p-4">
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
    </Card>
  );
}
