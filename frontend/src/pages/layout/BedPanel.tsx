import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RulerDimensionLine, Trash2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Input, Select, Textarea } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import { useSnackbar } from "@/components/Snackbar";
import { ApiError, deleteBed, updateBed, type Bed, type BedEquipment, type BedUpdate, type Plant, type Planting, type RectangleGeometry } from "@/api/client";
import { ShapeTypeToggle } from "./ShapeTypeToggle";
import { boundingRect, plantingsOutsideBounds, rotationFromGardenRelative, rotationRelativeToGarden } from "./geometry";
import { todayIsoDate } from "./plantingLifecycle";

interface BedPanelProps {
  bed: Bed;
  /** The garden's own compass bearing (`Garden.orientation_deg`) - lets the
   * Rotation input below be expressed relative to the garden's orientation
   * (0 = "aligned with the garden") instead of an independent absolute
   * angle. Defaults to 0 (north-up) when there's no garden yet, matching
   * `Garden.orientation_deg`'s own default. */
  gardenOrientationDeg?: number;
  /** Every planting across the whole garden (not just this bed, not
   * date-filtered) - used to build the read-only History section below
   * (#180): this bed's own already-removed plantings, most recent first. */
  plantings: Planting[];
  /** Every equipment item across the whole garden (not just this bed) -
   * same whole-garden-then-filter-by-bed.id convention `plantings` above
   * already uses. Used only to distinguish a genuinely empty bed from an
   * occupied one on delete (#219) - this panel has no equipment-editing UI
   * of its own (that's `EquipmentPanel`'s job). */
  equipment: BedEquipment[];
  plantsBySlug: Map<string, Plant>;
  onClose: () => void;
  onDeleted: () => void;
}

/** Exposed so Layout.tsx's global Delete-key handler (see the "Keyboard
 * shortcuts" backlog item) can trigger exactly the same confirm-dialog-open
 * action the trash button below already does, rather than duplicating or
 * bypassing that confirmation step. */
export interface BedPanelHandle {
  requestDelete: () => void;
}

export const BedPanel = forwardRef<BedPanelHandle, BedPanelProps>(function BedPanel(
  { bed, gardenOrientationDeg = 0, plantings, equipment, plantsBySlug, onClose, onDeleted },
  ref,
) {
  const queryClient = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const [draft, setDraft] = useState(bed);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Opened from deleteMutation's onError below when the first delete 409s
  // because the bed still has plantings/equipment attached - the user's own
  // requested fix (see the backlog item) rather than the 409 being silently
  // swallowed, which is what happened before this.
  const [confirmCascadeOpen, setConfirmCascadeOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => setDraft(bed), [bed]);

  useImperativeHandle(ref, () => ({
    requestDelete: () => {
      setDeleteError(null);
      setConfirmDeleteOpen(true);
    },
  }));

  // #219: whether this bed has any *real* content worth warning about
  // before a cascade delete - see deleteMutation's onError below.
  const bedPlantingsCount = plantings.filter((p) => p.bed_id === bed.id).length;
  const bedEquipmentCount = equipment.filter((e) => e.bed_id === bed.id).length;

  const mutation = useMutation({
    mutationFn: (patch: BedUpdate) => updateBed(bed.id!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) =>
        old ? old.map((b) => (b.id === updated.id ? updated : b)) : old,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (cascade: boolean) => deleteBed(bed.id!, cascade),
    onSuccess: () => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) => old?.filter((b) => b.id !== bed.id));
      onDeleted();
    },
    onError: (err: unknown, cascade) => {
      if (err instanceof ApiError && err.status === 409) {
        // #219: every bed - even one that's never had a planting or
        // equipment item placed in it - auto-generates a background
        // prepare_bed Action the moment it's created (#192), which is
        // enough on its own to 409 a plain (non-cascade) delete. Showing
        // this bed's own dialog copy ("still has plantings or equipment")
        // for a genuinely empty bed would be actively misleading, so a
        // bed with zero *real* content (checked against already-loaded
        // plantings/equipment, not another round-trip) retries silently
        // with cascade=true instead - restoring #81/#83's original
        // "confirming deletes an empty bed directly, with no second
        // dialog" behavior. Only a bed with real plantings/equipment
        // attached gets the cascade-confirm dialog, still accurate for
        // that case. The `cascade` guard against the mutation's own
        // second (cascade=true) attempt avoids an infinite retry loop if
        // that one somehow also 409s (a different dependent row - the
        // dialog is still the right fallback there).
        if (!cascade && bedPlantingsCount === 0 && bedEquipmentCount === 0) {
          deleteMutation.mutate(true);
          return;
        }
        setDeleteError(null);
        setConfirmCascadeOpen(true);
      } else {
        setDeleteError(err instanceof Error ? err.message : "Failed to delete bed");
      }
    },
  });

  function commit(patch: BedUpdate) {
    setDraft((prev) => ({ ...prev, ...patch }) as Bed);
    mutation.mutate(patch);
    // Same "warn, don't silently re-clamp" check as Layout.tsx's canvas
    // drag/resize path (#198) - the Width/Length number inputs above are a
    // second way a bed's own footprint can shrink out from under its
    // existing plantings, so this needs the identical check, not just the
    // canvas Transformer path.
    if (patch.border_geometry) {
      const nextRect = boundingRect(patch.border_geometry);
      const previousRect = boundingRect(bed.border_geometry);
      if (nextRect.width !== previousRect.width || nextRect.height !== previousRect.height) {
        const bedPlantings = plantings.filter((p) => p.bed_id === bed.id);
        const outside = plantingsOutsideBounds(bedPlantings, nextRect.width, nextRect.height);
        if (outside.length > 0) {
          showSnackbar(
            `${outside.length} planting${outside.length === 1 ? "" : "s"} in "${bed.name}" now ${outside.length === 1 ? "sits" : "sit"} outside its resized edges.`,
          );
        }
      }
    }
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

  // History section (#180) - this bed's own already-removed plantings,
  // most recent removal first. Deliberately past-only (not "scheduled to
  // leave" ones, which still render live on the canvas today) - see
  // plantingLifecycle.ts's isPlantingActiveAsOf for the same "as of today"
  // cutoff the Edit tab's canvas rendering itself uses.
  const today = todayIsoDate();
  const pastPlantings = plantings
    .filter((p) => p.bed_id === bed.id && p.removed_date && p.removed_date <= today)
    .sort((a, b) => (b.removed_date ?? "").localeCompare(a.removed_date ?? ""));

  return (
    <Card className="w-80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Edit bed</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {/* #213: explicit htmlFor/id on every field below - overrides the
            browser's implicit label-association algorithm entirely, so
            FieldHint's own <button> (rendered before the real control)
            never steals it. */}
        <label className="flex flex-col gap-1" htmlFor="bed-field-name">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Name
            <FieldHint description="The bed's display name, e.g. 'North planter'." />
          </span>
          <Input
            id="bed-field-name"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            onBlur={() => draft.name !== bed.name && commit({ name: draft.name })}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="bed-field-category">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Category (optional)
            <FieldHint description="Free-text grouping, e.g. raised planter, ground bed, compost bin - not a fixed list." />
          </span>
          <Input
            id="bed-field-category"
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
            <label className="flex flex-col gap-1" htmlFor="bed-field-width">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Width (cm)
                <FieldHint description="Bed width in centimeters." />
              </span>
              <Input
                id="bed-field-width"
                type="number"
                variant="numeric"
                value={draft.border_geometry.width}
                onChange={(e) => setRectField("width", Number(e.target.value))}
                onBlur={() => {
                  if (draft.border_geometry.type === "rectangle" && draft.border_geometry.width !== originalRect?.width) {
                    commit({ border_geometry: draft.border_geometry });
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="bed-field-length">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Length (cm)
                <FieldHint description="Bed length in centimeters." />
              </span>
              <Input
                id="bed-field-length"
                type="number"
                variant="numeric"
                value={draft.border_geometry.height}
                onChange={(e) => setRectField("height", Number(e.target.value))}
                onBlur={() => {
                  if (draft.border_geometry.type === "rectangle" && draft.border_geometry.height !== originalRect?.height) {
                    commit({ border_geometry: draft.border_geometry });
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="bed-field-rotation">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Rotation (°)
                <FieldHint description="Rotation in degrees, clockwise, relative to the garden's own orientation - 0 means aligned with the garden, not with the canvas." />
              </span>
              <Input
                id="bed-field-rotation"
                type="number"
                variant="numeric"
                value={Math.round(rotationRelativeToGarden(draft.border_geometry.rotation, gardenOrientationDeg))}
                onChange={(e) =>
                  setRectField("rotation", rotationFromGardenRelative(Number(e.target.value), gardenOrientationDeg))
                }
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

        <label className="flex flex-col gap-1" htmlFor="bed-field-height">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Height (cm)
            <FieldHint description="Height above ground, in centimeters - 0 for a flat/ground-level bed. Any height above ground draws the bed with a thicker outline on the canvas." />
          </span>
          <Input
            id="bed-field-height"
            type="number"
            value={draft.height_cm}
            onChange={(e) => setDraft((prev) => ({ ...prev, height_cm: Number(e.target.value) }))}
            onBlur={() => draft.height_cm !== bed.height_cm && commit({ height_cm: draft.height_cm })}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="bed-field-sun-level">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Sun level
            <FieldHint description="How much direct sun this bed gets." />
          </span>
          <Select
            id="bed-field-sun-level"
            value={draft.sun_level ?? ""}
            onChange={(e) => commit({ sun_level: (e.target.value || null) as Bed["sun_level"] })}
          >
            <option value="">—</option>
            <option value="full_sun">Full sun</option>
            <option value="half_sun">Half sun</option>
            <option value="shadow">Shadow</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1" htmlFor="bed-field-soil-type">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Soil type
            <FieldHint description="Free-text soil description, e.g. loam, sandy, compost-amended." />
          </span>
          <Input
            id="bed-field-soil-type"
            value={draft.soil_type ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, soil_type: e.target.value || null }))}
            onBlur={() => draft.soil_type !== bed.soil_type && commit({ soil_type: draft.soil_type })}
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.has_greenhouse}
            onChange={(e) => commit({ has_greenhouse: e.target.checked })}
          />
          <span className="text-sm">Greenhouse</span>
          <FieldHint description="Whether this bed is inside/covered by a greenhouse." />
        </label>

        <label className="flex flex-col gap-1" htmlFor="bed-field-notes">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Notes
            <FieldHint description="Any other notes about this bed." />
          </span>
          <Textarea
            id="bed-field-notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
            onBlur={() => draft.notes !== bed.notes && commit({ notes: draft.notes })}
          />
        </label>

        <Link
          to={`/layout/beds/${bed.id}/technical-drawing`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <RulerDimensionLine /> View technical drawing
        </Link>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">History</span>
          {pastPlantings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No past plantings recorded for this bed yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {pastPlantings.map((p) => (
                <li key={p.id} className="text-xs">
                  <span className="font-medium">{plantsBySlug.get(p.plant_slug)?.common_name ?? p.plant_slug}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {p.planted_date ?? "unknown start"} – {p.removed_date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setDeleteError(null);
            setConfirmDeleteOpen(true);
          }}
        >
          <Trash2 /> Delete bed
        </Button>
        {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Delete bed "{bed.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the bed and its layout permanently - it can't be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteMutation.mutate(false)}>
              <Trash2 /> Delete bed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog open={confirmCascadeOpen} onOpenChange={setConfirmCascadeOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>"{bed.name}" still has plantings or equipment</AlertDialogTitle>
          <AlertDialogDescription>
            Delete the bed and everything placed in it (plantings, equipment) too? If not, the bed can't be deleted
            either.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteMutation.mutate(true)}>
              <Trash2 /> Delete bed and its plantings/equipment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Card>
  );
});
