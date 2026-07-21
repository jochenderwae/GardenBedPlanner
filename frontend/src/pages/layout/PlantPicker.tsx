import type { Plant } from "@/api/client";
import { PlantSearchList } from "@/components/PlantSearchList";

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
 * the match", not browse/filter/sort. The search-and-list itself is the
 * shared `PlantSearchList` primitive (also used inline by the plant-detail
 * Companions section) - this component only adds the popover's
 * fixed-position overlay chrome and click-outside-to-close behavior. */
export function PlantPicker({ x, y, plants, onPick, onClose }: PlantPickerProps) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <PlantSearchList plants={plants} onPick={onPick} />
      </div>
    </div>
  );
}
