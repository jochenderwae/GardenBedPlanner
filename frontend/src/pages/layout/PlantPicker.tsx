import type { RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import type { Plant } from "@/api/client";
import { PlantSearchList } from "@/components/PlantSearchList";

interface PlantPickerProps {
  open: boolean;
  anchorRef: RefObject<HTMLDivElement | null>;
  plants: Plant[];
  onPick: (slug: string) => void;
  onClose: () => void;
}

/** Small search-and-pick popover for placing a plant, anchored to the
 * toolbar button that opens it (`plantPickerAnchorRef`, forwarded from
 * `Layout.tsx`/`Toolbar.tsx`). Deliberately not the full tree-table UX from
 * PlantsDatabase.tsx - this just needs "type a few letters, click the
 * match", not browse/filter/sort. The search-and-list itself is the shared
 * `PlantSearchList` primitive (also used inline by the plant-detail
 * Companions section) - this component only adds the popover's positioning
 * and open/close chrome.
 *
 * Uses Base UI's `Popover` primitive (non-modal, unlike the `Dialog`
 * `AddBedForm`/`AddPlantForm` migrated to) rather than a hand-rolled
 * `fixed inset-0` overlay: a quick anchored plant search shouldn't trap
 * focus the way a full modal dialog does, but it still gets Escape-to-close
 * and outside-press-to-close, and correct `role`/positioning, for free from
 * the library instead of being reimplemented by hand. */
export function PlantPicker({ open, anchorRef, plants, onPick, onClose }: PlantPickerProps) {
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchorRef} side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className="w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none">
            <PlantSearchList plants={plants} onPick={onPick} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
