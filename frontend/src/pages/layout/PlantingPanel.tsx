import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input, Select } from "@/components/ui/input";
import { deletePlanting, updatePlanting, type PlacementType, type Plant, type Planting, type PlantingUpdate } from "@/api/client";
import { defaultPlantSpacing } from "./geometry";
import { describePlantingSchedule, describeRemovalSchedule, todayIsoDate } from "./plantingLifecycle";

const PLACEMENT_TYPE_LABELS: Record<PlacementType, string> = {
  individual: "Point",
  row: "Row",
  field: "Area",
};

interface PlantingPanelProps {
  planting: Planting;
  plant: Plant | undefined;
  onClose: () => void;
  onDeleted: () => void;
}

/** Exposed so Layout.tsx's global Delete-key handler (see the "Keyboard
 * shortcuts" backlog item) can trigger exactly the same confirm-dialog-open
 * action the trash button below already does, rather than duplicating or
 * bypassing that confirmation step. */
export interface PlantingPanelHandle {
  requestDelete: () => void;
}

/** Edits a placed plant's own record (placement type, planted/removed
 * dates) - opened by clicking a planting marker on the canvas, matching how
 * clicking a bed opens `BedPanel`. Owns its own mutations rather than
 * routing through Layout.tsx, same split `BedPanel` already uses: canvas-
 * drag geometry changes stay centralized in Layout.tsx (`handlePlantingMove`,
 * used while dragging a marker), but panel-driven field edits and delete
 * are local to the panel. Delete lives here (with a confirmation), not as
 * the marker's primary click/double-click gesture anymore. */
export const PlantingPanel = forwardRef<PlantingPanelHandle, PlantingPanelProps>(function PlantingPanel(
  { planting, plant, onClose, onDeleted },
  ref,
) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(planting);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => setDraft(planting), [planting]);

  useImperativeHandle(ref, () => ({
    requestDelete: () => setConfirmDeleteOpen(true),
  }));

  const mutation = useMutation({
    mutationFn: (patch: PlantingUpdate) => updatePlanting(planting.id!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) =>
        old ? old.map((p) => (p.id === updated.id ? updated : p)) : old,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlanting(planting.id!),
    onSuccess: () => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) => old?.filter((p) => p.id !== planting.id));
      onDeleted();
    },
  });

  function commit(patch: PlantingUpdate) {
    setDraft((prev) => ({ ...prev, ...patch }) as Planting);
    mutation.mutate(patch);
  }

  const label = plant?.common_name ?? planting.plant_slug;

  return (
    <Card className="w-72 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{label}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {plant && <p className="-mt-2 text-xs text-muted-foreground italic">{plant.botanical_name}</p>}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Placement type</span>
          <Select
            value={draft.placement_type}
            onChange={(e) => commit({ placement_type: e.target.value as PlacementType })}
          >
            {(Object.keys(PLACEMENT_TYPE_LABELS) as PlacementType[]).map((t) => (
              <option key={t} value={t}>
                {PLACEMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Planted date</span>
          <Input
            type="date"
            value={draft.planted_date ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, planted_date: e.target.value || null }))}
            onBlur={() => draft.planted_date !== planting.planted_date && commit({ planted_date: draft.planted_date })}
          />
          {/* Derived purely from planted_date vs. today, not a separate
              stored field (#201, the "not yet in the ground" mirror of
              removed_date's identical treatment below) - lets a
              future-dated planting stay visible on the canvas (see
              PlantPlacementLayer's startState-driven dashed/opacity
              treatment) while still reading clearly here as "not planted
              yet, but scheduled". */}
          {describePlantingSchedule(draft, todayIsoDate()) && (
            <span className="text-xs text-muted-foreground">{describePlantingSchedule(draft, todayIsoDate())}</span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Removed date</span>
          <Input
            type="date"
            value={draft.removed_date ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, removed_date: e.target.value || null }))}
            onBlur={() => draft.removed_date !== planting.removed_date && commit({ removed_date: draft.removed_date })}
          />
          {/* Derived purely from removed_date vs. today, not a separate
              stored field (#180) - lets a future-dated removal stay visible
              on the canvas (see PlantPlacementLayer's removalState-driven
              dashed/opacity treatment) while still reading clearly here as
              "not gone yet, but scheduled". */}
          {describeRemovalSchedule(draft, todayIsoDate()) && (
            <span className="text-xs text-muted-foreground">{describeRemovalSchedule(draft, todayIsoDate())}</span>
          )}
        </label>

        {(draft.placement_type === "row" || draft.placement_type === "field") &&
          (() => {
            // Prefers the plant's own recommended in-row planting distance
            // (plant_spacing_cm) over its mature-footprint size (spread_cm)
            // - see geometry.ts's defaultPlantSpacing (#195). Same fallback
            // this field's own placeholder/blank-value default already
            // needs to match what actually gets used on the canvas.
            const defaultSpacing = defaultPlantSpacing(plant);
            return (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Plant spacing (cm){defaultSpacing != null && !draft.spacing_cm && ` - default ${defaultSpacing}`}
                </span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder={defaultSpacing != null ? String(defaultSpacing) : undefined}
                  value={draft.spacing_cm ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, spacing_cm: e.target.value === "" ? null : Number(e.target.value) }))}
                  onBlur={() => draft.spacing_cm !== planting.spacing_cm && commit({ spacing_cm: draft.spacing_cm })}
                />
              </label>
            );
          })()}

        <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteOpen(true)}>
          <Trash2 /> Remove planting
        </Button>
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>This removes the planting permanently - it can't be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteMutation.mutate()}>
              <Trash2 /> Remove planting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Card>
  );
});
