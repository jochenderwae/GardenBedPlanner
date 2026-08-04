import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import { createDecoration, type Decoration, type Geometry } from "@/api/client";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { ShapeTypeToggle } from "./ShapeTypeToggle";

const DEFAULT_COLOR = "#78716c"; // stone-gray - matches Decoration.color's own backend default
const DEFAULT_SIZE_CM = 50;

function defaultGeometry(nextPosition: { pos_x: number; pos_y: number }): Geometry {
  return {
    type: "rectangle",
    x: nextPosition.pos_x,
    y: nextPosition.pos_y,
    width: DEFAULT_SIZE_CM,
    height: DEFAULT_SIZE_CM,
    rotation: 0,
  };
}

interface AddDecorationFormProps {
  onCreated: (decoration: Decoration) => void;
  nextPosition: { pos_x: number; pos_y: number };
}

/** "Add decoration" (#241/#242) - a purely cosmetic garden object (path,
 * bench, garden gnome, ...), sibling to `AddBedForm`/`AddCompostBinForm`:
 * same Dialog/Card/form shell, description + color + shape instead of
 * name + category + shape. */
export function AddDecorationForm({ onCreated, nextPosition }: AddDecorationFormProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(() => defaultGeometry(nextPosition));

  const nextPositionRef = useRef(nextPosition);
  nextPositionRef.current = nextPosition;

  useEffect(() => {
    if (!open) return;
    setName("");
    setColor(DEFAULT_COLOR);
    setGeometry(defaultGeometry(nextPositionRef.current));
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      createDecoration({
        name: name.trim(),
        color,
        border_geometry: geometry,
        notes: "",
      }),
    onSuccess: (decoration) => {
      queryClient.setQueryData<Decoration[]>(["decorations"], (old) => (old ? [...old, decoration] : [decoration]));
      setOpen(false);
      onCreated(decoration);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to create decoration"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Description is required.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Palette /> Add decoration
          </Button>
        }
      />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-medium">Add decoration</DialogTitle>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>

            <label className="flex flex-col gap-1" htmlFor="add-decoration-field-name">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Description
                <FieldHint description="What this is, e.g. 'Path', 'Bench', 'Garden gnome'." />
              </span>
              <Input
                id="add-decoration-field-name"
                placeholder="e.g. path, bench, garden gnome..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Color
                <FieldHint description="How this renders on the canvas - pick a preset or a custom color." />
              </span>
              <ColorSwatchPicker value={color} onChange={setColor} />
            </div>

            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Shape
                <FieldHint description="Rectangle is the default and works for most decorations; switch to Polygon for an irregular shape, e.g. a curved path." />
              </span>
              <ShapeTypeToggle geometry={geometry} onChange={setGeometry} />
            </div>

            <p className="text-xs text-muted-foreground">
              Starts at {DEFAULT_SIZE_CM}×{DEFAULT_SIZE_CM}cm - drag/resize/rotate (or edit vertices, for a polygon)
              after creating.
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
