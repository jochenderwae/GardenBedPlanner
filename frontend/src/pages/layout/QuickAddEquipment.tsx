import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBedEquipment, type BedEquipment, type EquipmentType } from "@/api/client";

interface QuickAddEquipmentProps {
  equipmentTypes: EquipmentType[];
  /** Same "no garden yet" condition `EquipmentPanel`'s own inventory
   * placement `Select` already gates "Place in garden…" on. */
  disabled: boolean;
  /** Fires once the item is created (still unplaced) - `Layout.tsx` chains
   * the exact same placement logic `EquipmentPanel`'s "Place in garden…"
   * option already triggers (`handleEquipmentPlaceInGarden`) onto this, so
   * one click both creates and places it. */
  onCreated: (item: BedEquipment) => void;
}

/** One-click create-and-place for garden-bound equipment (a rain barrel,
 * pathway, etc. - #207/#208's `EquipmentType.category` of
 * `garden_bound_functional`/`garden_bound_decorative`) that today takes two
 * separate steps (type free text into the inventory form, then pick "Place
 * in garden…" from a Select) - #242's own "Quick add" gap fix. Lists every
 * `EquipmentType` whose category isn't `bed_bound` (those need a bed
 * target, which a from-scratch quick-add against the garden as a whole
 * can't supply) generalizing to whatever's in `data/equipment_types.json`
 * rather than hardcoding "Rain barrel." Same popover-trigger composition
 * `PlantPicker.tsx` already established (Base UI `Popover.Trigger`, always
 * mounted with real internal `open` state - see that file's own doc on why
 * a `Trigger` specifically is load-bearing for focus-return-on-close), and
 * the same "real `<button>` per option, natural Tab order" list convention
 * `PlantSearchList.tsx` already uses rather than a hand-rolled roving-
 * arrow-key menu. */
export function QuickAddEquipment({ equipmentTypes, disabled, onCreated }: QuickAddEquipmentProps) {
  const [open, setOpen] = useState(false);
  const candidates = equipmentTypes.filter((t) => t.category !== "bed_bound");

  const mutation = useMutation({
    mutationFn: (type: EquipmentType) =>
      createBedEquipment({
        bed_id: null,
        equipment_type: type.name,
        geometry: null,
        height_cm: null,
        water_delivery_lph: null,
        condition: "good",
      }),
    onSuccess: (created) => {
      setOpen(false);
      onCreated(created);
    },
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button size="sm" variant="outline" disabled={disabled}>
            <PackagePlus /> Quick add
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className="w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none">
            {candidates.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No garden-bound equipment types on file.</p>
            )}
            {candidates.map((type) => (
              <button
                key={type.slug}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(type)}
              >
                {type.name}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
