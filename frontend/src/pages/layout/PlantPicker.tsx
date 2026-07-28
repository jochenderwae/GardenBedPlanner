import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import type { Plant } from "@/api/client";
import { PlantSearchList } from "@/components/PlantSearchList";

interface PlantPickerProps {
  plants: Plant[];
  /** Drives the trigger button's own label/styling ("Pick a plant" vs. the
   * armed plant's name) - the popover itself doesn't otherwise need to know
   * which plant (if any) is currently armed. */
  armedPlant: Plant | null;
  onPick: (slug: string) => void;
}

/** Small search-and-pick popover for placing a plant - renders both its own
 * "Pick a plant" trigger button and the popover itself, always mounted
 * (not conditionally rendered by the caller) with `open` as real internal
 * state, using Base UI's `Popover.Trigger` rather than a plain external
 * button + a manually-tracked anchor ref (this component's own previous
 * shape). Both changes needed for Base UI's focus-return-on-close behavior
 * to actually fire - see `dialog.tsx`'s own `DialogTrigger` doc for the
 * full explanation (the same root cause applies to `Popover.Trigger`, via
 * the same underlying floating-ui-react mechanism); #144's own follow-up
 * bug report found this popover was *already* always-mounted with a real
 * toggling `open` prop and still had the bug, confirming a `Trigger`
 * specifically (not just "stay mounted") is what's load-bearing here.
 *
 * Deliberately not the full tree-table UX from `PlantsDatabase.tsx` - this
 * just needs "type a few letters, click the match", not browse/filter/sort.
 * The search-and-list itself is the shared `PlantSearchList` primitive
 * (also used inline by the plant-detail Companions section) - this
 * component only adds the popover's trigger/positioning/open-close chrome.
 *
 * Non-modal (unlike `AddBedForm`/`AddPlantForm`'s `Dialog`) - a quick
 * anchored plant search shouldn't trap focus the way a full modal does, but
 * it still gets Escape-to-close and outside-press-to-close, and correct
 * `role`/positioning, for free from the library instead of being
 * reimplemented by hand. */
export function PlantPicker({ plants, armedPlant, onPick }: PlantPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button size="sm" variant={armedPlant ? "outline" : "default"}>
            {armedPlant ? armedPlant.common_name : "Pick a plant"}
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className="w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none">
            <PlantSearchList
              plants={plants}
              onPick={(slug) => {
                onPick(slug);
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
