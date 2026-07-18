import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listPlants, type Plant } from "@/api/client";

interface GenusGroup {
  key: string;
  genus: string | null;
  plants: Plant[];
}

interface FamilyGroup {
  key: string;
  family: string | null;
  plantCount: number;
  /** Genus subgroups with 2+ members - the collapsible middle tier.
   * Genera with exactly one plant in this family aren't wrapped here;
   * their plant is folded into singletonPlants instead. */
  genusGroups: GenusGroup[];
  /** Plants whose genus (within this family) has no other member - shown
   * directly under the family, one level shallower than a real genus group. */
  singletonPlants: Plant[];
}

function sortByCommonName(plants: Plant[]): Plant[] {
  return [...plants].sort((a, b) => a.common_name.localeCompare(b.common_name));
}

/** Two-tier grouping: family, then genus within it (e.g. Solanaceae contains
 * Solanum - tomato/potato/eggplant - and Capsicum - peppers - as separate
 * sub-groups; they don't merge, since peppers are a different genus). Tested
 * against the real data first: genus alone doesn't unite peppers with
 * tomato/potato/eggplant (Capsicum vs Solanum), only family does - hence the
 * two levels rather than genus alone. A group with a single member at either
 * tier collapses into a flat row instead of a redundant one-item expander. */
function groupByFamilyThenGenus(plants: Plant[]): FamilyGroup[] {
  const byFamily = new Map<string, Plant[]>();
  for (const plant of plants) {
    const key = plant.family || `__no-family__${plant.slug}`;
    const existing = byFamily.get(key);
    if (existing) existing.push(plant);
    else byFamily.set(key, [plant]);
  }

  const families: FamilyGroup[] = Array.from(byFamily.entries()).map(([key, familyPlants]) => {
    const byGenus = new Map<string, Plant[]>();
    for (const plant of familyPlants) {
      const genusKey = plant.genus || `__no-genus__${plant.slug}`;
      const existing = byGenus.get(genusKey);
      if (existing) existing.push(plant);
      else byGenus.set(genusKey, [plant]);
    }

    const genusGroups: GenusGroup[] = [];
    const singletonPlants: Plant[] = [];
    for (const [genusKey, genusPlants] of byGenus) {
      if (genusPlants.length > 1) {
        genusGroups.push({ key: `${key}::${genusKey}`, genus: genusPlants[0].genus, plants: sortByCommonName(genusPlants) });
      } else {
        singletonPlants.push(genusPlants[0]);
      }
    }
    genusGroups.sort((a, b) => (a.genus ?? "").localeCompare(b.genus ?? ""));

    return {
      key,
      family: familyPlants[0].family,
      plantCount: familyPlants.length,
      genusGroups,
      singletonPlants: sortByCommonName(singletonPlants),
    };
  });

  return families.sort((a, b) => (a.family ?? "").localeCompare(b.family ?? ""));
}

export function PlantsDatabase() {
  const navigate = useNavigate();
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [expandedGenera, setExpandedGenera] = useState<Set<string>>(new Set());

  const { data, isPending, isError } = useQuery({
    queryKey: ["plants"],
    queryFn: () => listPlants(500),
  });

  const families = useMemo(() => groupByFamilyThenGenus(data ?? []), [data]);

  function toggleFamily(key: string) {
    setExpandedFamilies((prev) => toggleInSet(prev, key));
  }
  function toggleGenus(key: string) {
    setExpandedGenera((prev) => toggleInSet(prev, key));
  }
  function openPlant(slug: string) {
    navigate(`/plants/${encodeURIComponent(slug)}`);
  }

  return (
    <div className="mx-auto max-w-4xl p-6 text-left">
      <h1 className="mb-4 text-xl font-medium">Plants database</h1>
      {isPending && <p className="text-sm text-muted-foreground">Loading plants…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load plants.</p>}
      {data && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Name</th>
              <th className="py-2 pr-2 font-medium">Botanical name</th>
              <th className="py-2 pr-2 font-medium">Family</th>
              <th className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {families.map((family) =>
              family.plantCount === 1 ? (
                <PlantRow
                  key={family.singletonPlants[0].slug}
                  plant={family.singletonPlants[0]}
                  depth={0}
                  onOpen={openPlant}
                />
              ) : (
                <FamilyRows
                  key={family.key}
                  family={family}
                  expanded={expandedFamilies.has(family.key)}
                  onToggleFamily={() => toggleFamily(family.key)}
                  expandedGenera={expandedGenera}
                  onToggleGenus={toggleGenus}
                  onOpen={openPlant}
                />
              ),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function FamilyRows({
  family,
  expanded,
  onToggleFamily,
  expandedGenera,
  onToggleGenus,
  onOpen,
}: {
  family: FamilyGroup;
  expanded: boolean;
  onToggleFamily: () => void;
  expandedGenera: Set<string>;
  onToggleGenus: (key: string) => void;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/50" onClick={onToggleFamily}>
        <td className="py-2 pr-2 font-medium" colSpan={3}>
          <span className="inline-flex items-center gap-1.5">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {family.family ?? "(unknown family)"}
            <span className="text-muted-foreground">({family.plantCount} plants)</span>
          </span>
        </td>
        <td className="py-2" />
      </tr>
      {expanded && (
        <>
          {family.genusGroups.map((genus) => (
            <GenusRows
              key={genus.key}
              genus={genus}
              expanded={expandedGenera.has(genus.key)}
              onToggle={() => onToggleGenus(genus.key)}
              onOpen={onOpen}
            />
          ))}
          {family.singletonPlants.map((plant) => (
            <PlantRow key={plant.slug} plant={plant} depth={1} onOpen={onOpen} />
          ))}
        </>
      )}
    </>
  );
}

function GenusRows({
  genus,
  expanded,
  onToggle,
  onOpen,
}: {
  genus: GenusGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/50" onClick={onToggle}>
        <td className="py-2 pr-2 pl-8" colSpan={3}>
          <span className="inline-flex items-center gap-1.5">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <em className="not-italic text-muted-foreground">{genus.genus ?? "(unknown genus)"}</em>
            <span className="text-muted-foreground">({genus.plants.length})</span>
          </span>
        </td>
        <td className="py-2" />
      </tr>
      {expanded &&
        genus.plants.map((plant) => (
          <PlantRow key={plant.slug} plant={plant} depth={2} onOpen={onOpen} />
        ))}
    </>
  );
}

function PlantRow({
  plant,
  depth,
  onOpen,
}: {
  plant: Plant;
  depth: number;
  onOpen: (slug: string) => void;
}) {
  return (
    <tr
      className="cursor-pointer border-b hover:bg-muted/50"
      onDoubleClick={() => onOpen(plant.slug)}
    >
      <td className={cn("py-2 pr-2", depth === 1 && "pl-8", depth === 2 && "pl-16")}>
        {plant.common_name}
      </td>
      <td className="py-2 pr-2 text-muted-foreground">{plant.botanical_name}</td>
      <td className="py-2 pr-2 text-muted-foreground">{plant.family}</td>
      <td className="py-2 text-right">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${plant.common_name}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(plant.slug);
          }}
        >
          <Pencil />
        </Button>
      </td>
    </tr>
  );
}
