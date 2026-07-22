import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { Plant } from "@/api/client";

interface PlantSearchListProps {
  plants: Plant[];
  onPick: (slug: string) => void;
  /** Whether the search input grabs focus on mount - the canvas editor's
   * popover usage (layout/PlantPicker.tsx) wants this since it opens as a
   * transient overlay; an inline, always-visible usage (e.g. the
   * plant-detail Companions section) generally doesn't. Defaults to true to
   * match PlantPicker's original behavior before this was extracted. */
  autoFocus?: boolean;
}

/** Type-a-few-letters-click-the-match plant search - the shared primitive
 * behind both the canvas editor's `PlantPicker` popover and any other
 * inline plant-picking UI that needs the same "search plants, pick one"
 * interaction without a popover's fixed-position overlay chrome (see the
 * plant-detail Companions section, which embeds this directly inline and
 * keeps it open/mounted across picks so its search text persists). */
export function PlantSearchList({ plants, onPick, autoFocus = true }: PlantSearchListProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = term
    ? plants.filter(
        (p) => p.common_name.toLowerCase().includes(term) || p.botanical_name.toLowerCase().includes(term),
      )
    : plants;

  return (
    <div>
      <Input
        placeholder="Search plants…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus={autoFocus}
      />
      <div className="mt-2 max-h-56 overflow-auto">
        {matches.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No matches.</p>}
        {matches.slice(0, 50).map((plant) => (
          <button
            key={plant.slug}
            type="button"
            className="flex w-full flex-col rounded px-2 py-1 text-left text-sm hover:bg-accent"
            onClick={() => onPick(plant.slug)}
          >
            <span>{plant.common_name}</span>
            <span className="text-xs text-muted-foreground italic">{plant.botanical_name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
