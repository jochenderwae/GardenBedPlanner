import { useState } from "react";
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
import { deletePlanting, type Planting } from "@/api/client";

interface BulkPlantingPanelProps {
  /** The plantings currently in the multi-selection (marquee-drag or
   * shift-click - see PlantPlacementLayer). */
  plantings: Planting[];
  onClose: () => void;
  onDeleted: () => void;
}

/** Shown instead of PlantingPanel while a multi-selection is active - a
 * lightweight "N selected" bar with bulk delete, not the full single-
 * planting edit form (placement type / planted-removed dates don't make
 * sense to bulk-edit at once). Moving a multi-selection is a canvas drag
 * gesture instead (drag any selected marker - see Layout.tsx's
 * handlePlantingMove), not a control here. */
export function BulkPlantingPanel({ plantings, onClose, onDeleted }: BulkPlantingPanelProps) {
  const queryClient = useQueryClient();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ids = plantings.map((p) => p.id).filter((id): id is number => id != null);

  const deleteMutation = useMutation({
    mutationFn: async (targetIds: number[]) => {
      await Promise.all(targetIds.map((id) => deletePlanting(id)));
      return targetIds;
    },
    onSuccess: (deletedIds) => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) =>
        old?.filter((p) => p.id == null || !deletedIds.includes(p.id)),
      );
      onDeleted();
    },
    onError: (err: unknown) => setDeleteError(err instanceof Error ? err.message : "Failed to delete some plantings"),
  });

  return (
    <Card className="w-72 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{ids.length} plantings selected</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Drag any selected marker to move the whole group together. Shift-click a marker, or drag a selection box, to
        add/remove markers from the selection.
      </p>

      <Button
        variant="destructive"
        size="sm"
        disabled={ids.length === 0 || deleteMutation.isPending}
        onClick={() => {
          setDeleteError(null);
          setConfirmDeleteOpen(true);
        }}
      >
        <Trash2 /> Remove {ids.length} plantings
      </Button>
      {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Remove {ids.length} plantings?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes all selected plantings permanently - it can't be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteMutation.mutate(ids)}>
              <Trash2 /> Remove {ids.length} plantings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Card>
  );
}
