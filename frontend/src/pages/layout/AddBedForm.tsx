import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import { createBed, type Bed, type Geometry } from "@/api/client";
import { ShapeTypeToggle } from "./ShapeTypeToggle";

// A reasonable default planter size (matches root CLAUDE.md's large
// planters) - there's no more fixed type -> default-size table since
// category is free text now; editable immediately after creation either
// way via drag/resize or the panel.
const DEFAULT_WIDTH_CM = 70;
const DEFAULT_HEIGHT_CM = 200;

function defaultGeometry(nextPosition: { pos_x: number; pos_y: number }): Geometry {
  return {
    type: "rectangle",
    x: nextPosition.pos_x,
    y: nextPosition.pos_y,
    width: DEFAULT_WIDTH_CM,
    height: DEFAULT_HEIGHT_CM,
    rotation: 0,
  };
}

interface AddBedFormProps {
  onCreated: (bed: Bed) => void;
  nextPosition: { pos_x: number; pos_y: number };
}

/** Renders both its own "Add bed" trigger button and the dialog itself,
 * always mounted (not conditionally rendered by the caller the way this
 * used to work) with `open` as real internal state - both changes needed
 * for Base UI's focus-return-on-close behavior to actually fire (see
 * `dialog.tsx`'s own `DialogTrigger` doc; #144's own follow-up bug report).
 * Resets its own fields back to blank each time it opens (not just on
 * mount, now that mounting happens once and `open` toggles thereafter) -
 * `nextPosition` is read fresh at that moment via a ref (not a `useEffect`
 * dependency) so the reset doesn't also fire, wiping in-progress field
 * edits, on every unrelated re-render caused by `nextPosition` changing
 * (recomputed from the live `beds` array on every one of the caller's own
 * renders) while the dialog happens to already be open. */
export function AddBedForm({ onCreated, nextPosition }: AddBedFormProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(() => defaultGeometry(nextPosition));

  const nextPositionRef = useRef(nextPosition);
  nextPositionRef.current = nextPosition;

  useEffect(() => {
    if (!open) return;
    setName("");
    setCategory("");
    setGeometry(defaultGeometry(nextPositionRef.current));
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      createBed({
        name: name.trim(),
        category: category.trim() || null,
        border_geometry: geometry,
        height_cm: 0,
        has_greenhouse: false,
        notes: "",
      }),
    onSuccess: (bed) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) => (old ? [...old, bed] : [bed]));
      setOpen(false);
      onCreated(bed);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to create bed"),
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
          <Button size="sm">
            <Plus /> Add bed
          </Button>
        }
      />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-medium">Add bed</DialogTitle>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Name
                <FieldHint description="The bed's display name, e.g. 'North planter'." />
              </span>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>

            <label className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Category (optional)
                <FieldHint description="Free-text grouping, e.g. raised planter, ground bed, compost bin - not a fixed list." />
              </span>
              <Input
                placeholder="e.g. raised planter, ground bed, compost..."
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Shape
                <FieldHint description="Rectangle is the default and works for most beds; switch to Polygon for an irregular shape." />
              </span>
              <ShapeTypeToggle geometry={geometry} onChange={setGeometry} />
            </label>

            <p className="text-xs text-muted-foreground">
              Starts at {DEFAULT_WIDTH_CM}×{DEFAULT_HEIGHT_CM}cm - drag/resize/rotate (or edit vertices, for a
              polygon) after creating.
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
