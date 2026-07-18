import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listPlants, type Plant } from "@/api/client";

interface SpeciesGroup {
  key: string;
  botanicalName: string | null;
  plants: Plant[];
}

/** Groups plants by botanical_name - cultivars of the same species (e.g.
 * Acorn Squash and Baby Bear Pumpkin, both Cucurbita pepo) share a group.
 * A species with only one plant on record renders as a flat row instead of
 * a group with a single, redundant child - not worth an expand click. */
function groupBySpecies(plants: Plant[]): SpeciesGroup[] {
  const byBotanicalName = new Map<string, Plant[]>();
  for (const plant of plants) {
    const key = plant.botanical_name || `__no-botanical-name__${plant.slug}`;
    const existing = byBotanicalName.get(key);
    if (existing) existing.push(plant);
    else byBotanicalName.set(key, [plant]);
  }
  return Array.from(byBotanicalName.entries())
    .map(([key, groupPlants]) => ({
      key,
      botanicalName: groupPlants[0].botanical_name,
      plants: groupPlants.sort((a, b) => a.common_name.localeCompare(b.common_name)),
    }))
    .sort((a, b) => (a.botanicalName ?? "").localeCompare(b.botanicalName ?? ""));
}

export function PlantsDatabase() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isPending, isError } = useQuery({
    queryKey: ["plants"],
    queryFn: () => listPlants(500),
  });

  const groups = useMemo(() => groupBySpecies(data ?? []), [data]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
            {groups.map((group) =>
              group.plants.length === 1 ? (
                <PlantRow
                  key={group.plants[0].slug}
                  plant={group.plants[0]}
                  depth={0}
                  onOpen={openPlant}
                />
              ) : (
                <SpeciesGroupRows
                  key={group.key}
                  group={group}
                  expanded={expanded.has(group.key)}
                  onToggle={() => toggle(group.key)}
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

function SpeciesGroupRows({
  group,
  expanded,
  onToggle,
  onOpen,
}: {
  group: SpeciesGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b hover:bg-muted/50"
        onClick={onToggle}
      >
        <td className="py-2 pr-2 font-medium" colSpan={3}>
          <span className="inline-flex items-center gap-1.5">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {group.botanicalName ?? "(unknown botanical name)"}
            <span className="text-muted-foreground">({group.plants.length} cultivars)</span>
          </span>
        </td>
        <td className="py-2" />
      </tr>
      {expanded &&
        group.plants.map((plant) => (
          <PlantRow key={plant.slug} plant={plant} depth={1} onOpen={onOpen} />
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
      <td className={cn("py-2 pr-2", depth > 0 && "pl-8")}>{plant.common_name}</td>
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
