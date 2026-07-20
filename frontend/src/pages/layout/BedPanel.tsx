import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import { deleteBed, updateBed, type Bed, type BedUpdate, type RectangleGeometry } from "@/api/client";
import { ShapeTypeToggle } from "./ShapeTypeToggle";

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** The width/length/rotation trio below is 3-up in a 20rem panel - real
 * tight on horizontal room, and the native number-input spinner arrows
 * alone were eating enough of it to clip a 3-digit cm value or a negative
 * rotation. Drops the spinner (`[appearance:textfield]` + hiding the
 * WebKit spin buttons) and trims the side padding a bit to give the digits
 * themselves back the room the browser chrome was taking. */
const numberInputClass = cn(
  inputClass,
  "px-1.5 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
);

interface BedPanelProps {
  bed: Bed;
  onClose: () => void;
  onDeleted: () => void;
}

export function BedPanel({ bed, onClose, onDeleted }: BedPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(bed);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => setDraft(bed), [bed]);

  const mutation = useMutation({
    mutationFn: (patch: BedUpdate) => updateBed(bed.id!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) =>
        old ? old.map((b) => (b.id === updated.id ? updated : b)) : old,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteBed(bed.id!),
    onSuccess: () => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) => old?.filter((b) => b.id !== bed.id));
      onDeleted();
    },
  });

  function commit(patch: BedUpdate) {
    setDraft((prev) => ({ ...prev, ...patch }) as Bed);
    mutation.mutate(patch);
  }

  function setRectField(key: keyof RectangleGeometry, value: number) {
    setDraft((prev) =>
      prev.border_geometry.type === "rectangle"
        ? { ...prev, border_geometry: { ...prev.border_geometry, [key]: value } }
        : prev,
    );
  }

  // originalRect/draftRect are only used inside the `geometry.type ===
  // "rectangle"` branch below, where TypeScript narrows draft.border_geometry
  // for us - keeping the discriminant check inline (not via a separate
  // boolean) is what makes that narrowing apply.
  const originalRect = bed.border_geometry.type === "rectangle" ? bed.border_geometry : null;

  return (
    <Card className="w-80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Edit bed</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            onBlur={() => draft.name !== bed.name && commit({ name: draft.name })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Category (optional)</span>
          <input
            className={inputClass}
            placeholder="e.g. raised planter, ground bed, compost..."
            value={draft.category ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value || null }))}
            onBlur={() => draft.category !== bed.category && commit({ category: draft.category })}
          />
        </label>

        <ShapeTypeToggle
          geometry={draft.border_geometry}
          onChange={(border_geometry) => commit({ border_geometry })}
        />

        {draft.border_geometry.type === "rectangle" ? (
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Width (cm)</span>
              <input
                type="number"
                className={numberInputClass}
                value={draft.border_geometry.width}
                onChange={(e) => setRectField("width", Number(e.target.value))}
                onBlur={() => {
                  if (draft.border_geometry.type === "rectangle" && draft.border_geometry.width !== originalRect?.width) {
                    commit({ border_geometry: draft.border_geometry });
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Length (cm)</span>
              <input
                type="number"
                className={numberInputClass}
                value={draft.border_geometry.height}
                onChange={(e) => setRectField("height", Number(e.target.value))}
                onBlur={() => {
                  if (draft.border_geometry.type === "rectangle" && draft.border_geometry.height !== originalRect?.height) {
                    commit({ border_geometry: draft.border_geometry });
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Rotation (°)</span>
              <input
                type="number"
                className={numberInputClass}
                value={draft.border_geometry.rotation}
                onChange={(e) => setRectField("rotation", Number(e.target.value))}
                onBlur={() => {
                  if (
                    draft.border_geometry.type === "rectangle" &&
                    draft.border_geometry.rotation !== originalRect?.rotation
                  ) {
                    commit({ border_geometry: draft.border_geometry });
                  }
                }}
              />
            </label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Polygon shape - edit vertices directly on the canvas.</p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Height (cm)</span>
          <input
            type="number"
            className={inputClass}
            value={draft.height_cm}
            onChange={(e) => setDraft((prev) => ({ ...prev, height_cm: Number(e.target.value) }))}
            onBlur={() => draft.height_cm !== bed.height_cm && commit({ height_cm: draft.height_cm })}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Orientation</span>
            <input
              className={inputClass}
              placeholder="e.g. N, SE"
              value={draft.orientation ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, orientation: e.target.value || null }))}
              onBlur={() => draft.orientation !== bed.orientation && commit({ orientation: draft.orientation })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Sun level</span>
            <select
              className={inputClass}
              value={draft.sun_level ?? ""}
              onChange={(e) => commit({ sun_level: (e.target.value || null) as Bed["sun_level"] })}
            >
              <option value="">—</option>
              <option value="full_sun">Full sun</option>
              <option value="half_sun">Half sun</option>
              <option value="shadow">Shadow</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Soil type</span>
          <input
            className={inputClass}
            value={draft.soil_type ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, soil_type: e.target.value || null }))}
            onBlur={() => draft.soil_type !== bed.soil_type && commit({ soil_type: draft.soil_type })}
          />
        </label>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.has_greenhouse}
              onChange={(e) => commit({ has_greenhouse: e.target.checked })}
            />
            <span className="text-sm">Greenhouse</span>
          </label>
          <span
            className="text-sm text-muted-foreground"
            title="Derived from height (cm), not a separate field - a bed with any height above ground counts as raised"
          >
            {draft.height_cm > 0 ? "Raised" : "Not raised"}
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <textarea
            className={inputClass}
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
            onBlur={() => draft.notes !== bed.notes && commit({ notes: draft.notes })}
          />
        </label>

        <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteOpen(true)}>
          <Trash2 /> Delete bed
        </Button>
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Delete bed "{bed.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the bed and its layout permanently - it can't be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteMutation.mutate()}>
              <Trash2 /> Delete bed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Card>
  );
}
