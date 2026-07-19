import { useState } from "react";
import type { Plant } from "@/api/client";

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface PlantPickerProps {
  x: number;
  y: number;
  plants: Plant[];
  onPick: (slug: string) => void;
  onClose: () => void;
}

/** Small search-and-pick popover for placing a plant, positioned at the
 * viewport coordinates of the canvas click that opened it (see
 * PlantPlacementLayer's PickerState). Deliberately not the full tree-table
 * UX from PlantsDatabase.tsx - this just needs "type a few letters, click
 * the match", not browse/filter/sort. */
export function PlantPicker({ x, y, plants, onPick, onClose }: PlantPickerProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = term
    ? plants.filter(
        (p) => p.common_name.toLowerCase().includes(term) || p.botanical_name.toLowerCase().includes(term),
      )
    : plants;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className={inputClass}
          placeholder="Search plants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
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
    </div>
  );
}
