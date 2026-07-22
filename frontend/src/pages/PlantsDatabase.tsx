import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Pencil, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createPlant, listPlants, type Plant } from "@/api/client";

type SortKey = "common_name" | "botanical_name" | "family";
type SortDir = "asc" | "desc";

interface GenusGroup {
  key: string;
  genus: string | null;
  plants: Plant[];
}

interface FamilyGroup {
  key: string;
  family: string | null;
  plantCount: number;
  allPlants: Plant[];
  /** Genus subgroups with 2+ members - the collapsible middle tier.
   * Genera with exactly one plant in this family aren't wrapped here;
   * their plant is folded into singletonPlants instead. */
  genusGroups: GenusGroup[];
  /** Plants whose genus (within this family) has no other member - shown
   * directly under the family, one level shallower than a real genus group. */
  singletonPlants: Plant[];
}

function sortValue(plant: Plant, key: SortKey): string {
  if (key === "family") return plant.family?.name ?? "";
  if (key === "botanical_name") return plant.botanical_name;
  return plant.common_name;
}

function sortPlants(plants: Plant[], key: SortKey, dir: SortDir): Plant[] {
  const sorted = [...plants].sort((a, b) => sortValue(a, key).localeCompare(sortValue(b, key)));
  return dir === "asc" ? sorted : sorted.reverse();
}

/** Up to 3 example common names for a group label, e.g. "Ribes (Red Currant,
 * Gooseberry, ...)" - always drawn from the alphabetically-first members so
 * the examples shown don't shuffle as the group's own sort order changes. */
function exampleNames(plants: Plant[], max = 3): string {
  const names = [...plants].map((p) => p.common_name).sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown}, ...` : shown;
}

function matchesSearch(plant: Plant, term: string): boolean {
  if (!term) return true;
  const haystack = [plant.common_name, plant.botanical_name, plant.family?.name, plant.genus?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

/** Two-tier grouping: family, then genus within it (e.g. Solanaceae contains
 * Solanum - tomato/potato/eggplant - and Capsicum - peppers - as separate
 * sub-groups; they don't merge, since peppers are a different genus). Tested
 * against the real data first: genus alone doesn't unite peppers with
 * tomato/potato/eggplant (Capsicum vs Solanum), only family does - hence the
 * two levels rather than genus alone. A group with a single member at either
 * tier collapses into a flat row instead of a redundant one-item expander. */
function groupByFamilyThenGenus(plants: Plant[], sortKey: SortKey, sortDir: SortDir): FamilyGroup[] {
  const byFamily = new Map<string, Plant[]>();
  for (const plant of plants) {
    const key = plant.family?.name || `__no-family__${plant.slug}`;
    const existing = byFamily.get(key);
    if (existing) existing.push(plant);
    else byFamily.set(key, [plant]);
  }

  const families: FamilyGroup[] = Array.from(byFamily.entries()).map(([key, familyPlants]) => {
    const byGenus = new Map<string, Plant[]>();
    for (const plant of familyPlants) {
      const genusKey = plant.genus?.name || `__no-genus__${plant.slug}`;
      const existing = byGenus.get(genusKey);
      if (existing) existing.push(plant);
      else byGenus.set(genusKey, [plant]);
    }

    const genusGroups: GenusGroup[] = [];
    const singletonPlants: Plant[] = [];
    for (const [genusKey, genusPlants] of byGenus) {
      if (genusPlants.length > 1) {
        genusGroups.push({
          key: `${key}::${genusKey}`,
          genus: genusPlants[0].genus?.name ?? null,
          plants: sortPlants(genusPlants, sortKey, sortDir),
        });
      } else {
        singletonPlants.push(genusPlants[0]);
      }
    }
    genusGroups.sort((a, b) => (a.genus ?? "").localeCompare(b.genus ?? ""));

    return {
      key,
      family: familyPlants[0].family?.name ?? null,
      plantCount: familyPlants.length,
      allPlants: familyPlants,
      genusGroups,
      singletonPlants: sortPlants(singletonPlants, sortKey, sortDir),
    };
  });

  const sorted = families.sort((a, b) => (a.family ?? "").localeCompare(b.family ?? ""));
  if (sortKey === "family" && sortDir === "desc") sorted.reverse();
  return sorted;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function PlantsDatabase() {
  const navigate = useNavigate();
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [expandedGenera, setExpandedGenera] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [sunFilter, setSunFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("common_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAddForm, setShowAddForm] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ["plants"],
    queryFn: () => listPlants(500),
  });

  const familyOptions = useMemo(() => {
    const names = new Set<string>();
    for (const plant of data ?? []) {
      if (plant.family?.name) names.add(plant.family.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const searchTerm = search.trim().toLowerCase();
  const searchActive = searchTerm.length > 0;

  const filtered = useMemo(() => {
    return (data ?? []).filter(
      (plant) =>
        matchesSearch(plant, searchTerm) &&
        (!familyFilter || plant.family?.name === familyFilter) &&
        (!sunFilter || plant.sun_level === sunFilter),
    );
  }, [data, searchTerm, familyFilter, sunFilter]);

  const families = useMemo(
    () => groupByFamilyThenGenus(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  function toggleFamily(key: string) {
    setExpandedFamilies((prev) => toggleInSet(prev, key));
  }
  function toggleGenus(key: string) {
    setExpandedGenera((prev) => toggleInSet(prev, key));
  }
  function openPlant(slug: string) {
    navigate(`/plants/${encodeURIComponent(slug)}`);
  }
  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const hasFilters = Boolean(search || familyFilter || sunFilter);
  function clearFilters() {
    setSearch("");
    setFamilyFilter("");
    setSunFilter("");
  }

  return (
    <div className="mx-auto max-w-4xl p-6 text-left">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-medium">Plants database</h1>
        <Button size="sm" onClick={() => setShowAddForm(true)}>
          <Plus /> Add plant
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            className="pl-8"
            placeholder="Search by name, botanical name, family, genus…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-auto"
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
        >
          <option value="">All families</option>
          {familyOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={sunFilter} onChange={(e) => setSunFilter(e.target.value)}>
          <option value="">All sun levels</option>
          <option value="full_sun">Full sun</option>
          <option value="half_sun">Half sun</option>
          <option value="shadow">Shadow</option>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X /> Clear
          </Button>
        )}
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading plants…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load plants.</p>}
      {data && (
        <>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plants match your search/filters.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-foreground/15 text-left">
                  <SortableHeader label="Name" sortKey="common_name" active={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortableHeader
                    label="Botanical name"
                    sortKey="botanical_name"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader label="Family" sortKey="family" active={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="w-10 py-2" />
                </tr>
              </thead>
              <tbody>
                {families.map((family) => (
                  <FamilyRows
                    key={family.key}
                    family={family}
                    expanded={searchActive || expandedFamilies.has(family.key)}
                    onToggleFamily={() => toggleFamily(family.key)}
                    expandedGenera={expandedGenera}
                    searchActive={searchActive}
                    onToggleGenus={toggleGenus}
                    onOpen={openPlant}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {showAddForm && <AddPlantForm onClose={() => setShowAddForm(false)} onCreated={openPlant} />}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <th className="py-2 pr-2 font-semibold">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs tracking-wide uppercase",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {isActive && (dir === "asc" ? <ChevronDown className="size-3.5 rotate-180" /> : <ChevronDown className="size-3.5" />)}
      </button>
    </th>
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
  searchActive,
  onToggleGenus,
  onOpen,
}: {
  family: FamilyGroup;
  expanded: boolean;
  onToggleFamily: () => void;
  expandedGenera: Set<string>;
  searchActive: boolean;
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
            <span className="text-muted-foreground">
              ({family.plantCount} plants: {exampleNames(family.allPlants)})
            </span>
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
              expanded={searchActive || expandedGenera.has(genus.key)}
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
            <span className="text-muted-foreground">({exampleNames(genus.plants)})</span>
          </span>
        </td>
        <td className="py-2" />
      </tr>
      {expanded &&
        genus.plants.map((plant) => <PlantRow key={plant.slug} plant={plant} depth={2} onOpen={onOpen} />)}
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
      <td className="py-2 pr-2 text-muted-foreground">{plant.family?.name}</td>
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

function AddPlantForm({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
  const queryClient = useQueryClient();
  const [commonName, setCommonName] = useState("");
  const [botanicalName, setBotanicalName] = useState("");
  const [family, setFamily] = useState("");
  const [genus, setGenus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createPlant({
        slug: slugify(commonName),
        common_name: commonName.trim(),
        botanical_name: botanicalName.trim(),
        family: family.trim() || null,
        genus: genus.trim() || null,
      }),
    onSuccess: (plant) => {
      queryClient.invalidateQueries({ queryKey: ["plants"] });
      onCreated(plant.slug);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to create plant");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!commonName.trim() || !botanicalName.trim()) {
      setError("Common name and botanical name are required.");
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Add plant</h2>
            <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Common name</span>
            <Input
              value={commonName}
              onChange={(e) => setCommonName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Botanical name</span>
            <Input value={botanicalName} onChange={(e) => setBotanicalName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Family (optional)</span>
            <Input value={family} onChange={(e) => setFamily(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Genus (optional)</span>
            <Input value={genus} onChange={(e) => setGenus(e.target.value)} />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
