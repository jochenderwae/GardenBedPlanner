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
import { Input, Textarea } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import { deleteDecoration, updateDecoration, type Decoration, type DecorationUpdate } from "@/api/client";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

interface DecorationPanelProps {
  decoration: Decoration;
  onClose: () => void;
  onDeleted: () => void;
}

/** Exposed so Layout.tsx's global Delete-key handler can trigger exactly the
 * same confirm-dialog-open action the trash button below already does - same
 * pattern as `BedPanelHandle`/`PlantingPanelHandle`. */
export interface DecorationPanelHandle {
  requestDelete: () => void;
}

/** Editing a decoration's own name/color/notes (#242) - deliberately no
 * geometry/shape fields here (unlike `BedPanel`'s Width/Length/Rotation
 * inputs): a decoration's footprint is edited directly on the canvas
 * (drag/resize/rotate/vertex-drag via `DecorationNode`), the same "Polygon
 * shape - edit vertices directly on the canvas" precedent `BedPanel` already
 * uses for its own polygon beds. No cascade-delete confirmation dialog the
 * way `BedPanel`'s delete flow needs (a decoration has no dependents at all
 * - see `Decoration`'s own backend docstring) - one confirm dialog, not two. */
export const DecorationPanel = forwardRef<DecorationPanelHandle, DecorationPanelProps>(function DecorationPanel(
  { decoration, onClose, onDeleted },
  ref,
) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(decoration);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => setDraft(decoration), [decoration]);

  useImperativeHandle(ref, () => ({
    requestDelete: () => {
      setDeleteError(null);
      setConfirmDeleteOpen(true);
    },
  }));

  const mutation = useMutation({
    mutationFn: (patch: DecorationUpdate) => updateDecoration(decoration.id!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Decoration[]>(["decorations"], (old) =>
        old ? old.map((d) => (d.id === updated.id ? updated : d)) : old,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDecoration(decoration.id!),
    onSuccess: () => {
      queryClient.setQueryData<Decoration[]>(["decorations"], (old) => old?.filter((d) => d.id !== decoration.id));
      onDeleted();
    },
    onError: (err: unknown) => setDeleteError(err instanceof Error ? err.message : "Failed to delete decoration"),
  });

  function commit(patch: DecorationUpdate) {
    setDraft((prev) => ({ ...prev, ...patch }));
    mutation.mutate(patch);
  }

  return (
    <Card className="w-80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Edit decoration</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1" htmlFor="decoration-field-name">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Description
            <FieldHint description="What this is, e.g. 'Path', 'Bench', 'Garden gnome'." />
          </span>
          <Input
            id="decoration-field-name"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            onBlur={() => draft.name !== decoration.name && commit({ name: draft.name })}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Color
            <FieldHint description="How this renders on the canvas - pick a preset or a custom color." />
          </span>
          <ColorSwatchPicker value={draft.color} onChange={(color) => commit({ color })} />
        </div>

        <p className="text-xs text-muted-foreground">Edit position/size/rotation directly on the canvas.</p>

        <label className="flex flex-col gap-1" htmlFor="decoration-field-notes">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Notes
            <FieldHint description="Any other notes about this decoration." />
          </span>
          <Textarea
            id="decoration-field-notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
            onBlur={() => draft.notes !== decoration.notes && commit({ notes: draft.notes })}
          />
        </label>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setDeleteError(null);
            setConfirmDeleteOpen(true);
          }}
        >
          <Trash2 /> Delete decoration
        </Button>
        {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Delete decoration "{decoration.name}"?</AlertDialogTitle>
          <AlertDialogDescription>This removes it from the canvas permanently - it can't be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteMutation.mutate()}>
              <Trash2 /> Delete decoration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Card>
  );
});
