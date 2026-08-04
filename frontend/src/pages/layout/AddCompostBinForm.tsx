import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Recycle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import { createBed, createCompostBin, type Bed, type CompostBin, type Geometry } from "@/api/client";
import { ShapeTypeToggle } from "./ShapeTypeToggle";

// Matches root CLAUDE.md's real compost bins (2x 1m³) - a plain square
// default, editable via drag/resize afterward like any other bed.
export const DEFAULT_COMPOST_BIN_SIZE_CM = 100;

function defaultGeometry(nextPosition: { pos_x: number; pos_y: number }): Geometry {
  return {
    type: "rectangle",
    x: nextPosition.pos_x,
    y: nextPosition.pos_y,
    width: DEFAULT_COMPOST_BIN_SIZE_CM,
    height: DEFAULT_COMPOST_BIN_SIZE_CM,
    rotation: 0,
  };
}

interface AddCompostBinFormProps {
  /** Fires once both the underlying `Bed` and its linked `CompostBin` row
   * exist - the caller (`Layout.tsx`) only needs the `Bed` (to select it,
   * same as `AddBedForm.onCreated`); the `CompostBin` row itself isn't
   * otherwise consumed at creation time, `BedPanel`'s own compost-bin
   * section re-fetches it. */
  onCreated: (bed: Bed, compostBin: CompostBin) => void;
  nextPosition: { pos_x: number; pos_y: number };
}

/** "Add compost bin" (#242, sibling to `AddBedForm`) - one user-facing
 * action that's two backend calls under one mutation/one spinner/one error
 * message: a plain `Bed` (no `category`, since a compost bin's "type" is now
 * expressed by which button created it, not the free-text Category field)
 * immediately followed by a linked `CompostBin` row (default `fill_state:
 * "empty"`). If the second call fails after the first succeeds, the result
 * is an orphaned plain `Bed` with no `CompostBin` row - same "no
 * distributed-transaction rollback" reality every other multi-step create in
 * this app already has (flagged, not solved, by this ticket's own design). */
export function AddCompostBinForm({ onCreated, nextPosition }: AddCompostBinFormProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Compost bin");
  const [error, setError] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(() => defaultGeometry(nextPosition));

  const nextPositionRef = useRef(nextPosition);
  nextPositionRef.current = nextPosition;

  useEffect(() => {
    if (!open) return;
    setName("Compost bin");
    setGeometry(defaultGeometry(nextPositionRef.current));
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const bed = await createBed({
        name: name.trim(),
        category: null,
        border_geometry: geometry,
        height_cm: 0,
        has_greenhouse: false,
        notes: "",
      });
      const compostBin = await createCompostBin({
        bed_id: bed.id as number,
        fill_state: "empty",
        last_turned_date: null,
        estimated_maturity_date: null,
        notes: "",
      });
      return { bed, compostBin };
    },
    onSuccess: ({ bed, compostBin }) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) => (old ? [...old, bed] : [bed]));
      queryClient.setQueryData<CompostBin[]>(["compost-bins"], (old) => (old ? [...old, compostBin] : [compostBin]));
      setOpen(false);
      onCreated(bed, compostBin);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to create compost bin"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Recycle /> Add compost bin
          </Button>
        }
      />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-medium">Add compost bin</DialogTitle>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>

            <label className="flex flex-col gap-1" htmlFor="add-compost-bin-field-name">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Name
                <FieldHint description="Distinguishes this bin from any others, e.g. 'Compost bin 1' or 'North compost bin'." />
              </span>
              <Input id="add-compost-bin-field-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>

            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Shape
                <FieldHint description="Rectangle is the default and works for most bins; switch to Polygon for an irregular shape." />
              </span>
              <ShapeTypeToggle geometry={geometry} onChange={setGeometry} />
            </div>

            <p className="text-xs text-muted-foreground">
              Starts at {DEFAULT_COMPOST_BIN_SIZE_CM}×{DEFAULT_COMPOST_BIN_SIZE_CM}cm - drag/resize/rotate after
              creating. Fill state, last turned, and estimated maturity are set afterward from the bed's own panel.
            </p>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </Card>
      </DialogPopup>
    </Dialog>
  );
}
