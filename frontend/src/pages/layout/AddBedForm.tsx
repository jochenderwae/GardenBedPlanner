import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createBed, type Bed, type BedType } from "@/api/client";
import { BED_TYPE_LABELS } from "./geometry";

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const BED_TYPE_OPTIONS = Object.entries(BED_TYPE_LABELS) as [BedType, string][];

// Sensible starting dimensions per type, matching root CLAUDE.md's real
// garden description - editable immediately after creation either way.
const DEFAULT_DIMENSIONS: Record<BedType, { width_cm: number; length_cm: number }> = {
  large_planter: { width_cm: 70, length_cm: 200 },
  small_planter: { width_cm: 30, length_cm: 70 },
  berry_row: { width_cm: 60, length_cm: 300 },
  compost_bin: { width_cm: 100, length_cm: 100 },
  fruit_tree: { width_cm: 150, length_cm: 150 },
};

interface AddBedFormProps {
  onClose: () => void;
  onCreated: (bed: Bed) => void;
  nextPosition: { pos_x: number; pos_y: number };
}

export function AddBedForm({ onClose, onCreated, nextPosition }: AddBedFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [bedType, setBedType] = useState<BedType>("large_planter");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createBed({
        name: name.trim(),
        bed_type: bedType,
        ...DEFAULT_DIMENSIONS[bedType],
        height_cm: 0,
        has_greenhouse: false,
        pos_x: nextPosition.pos_x,
        pos_y: nextPosition.pos_y,
        notes: "",
      }),
    onSuccess: (bed) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) => (old ? [...old, bed] : [bed]));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Add bed</h2>
            <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Type</span>
            <select
              className={inputClass}
              value={bedType}
              onChange={(e) => setBedType(e.target.value as BedType)}
            >
              {BED_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <p className="text-xs text-muted-foreground">
            Starts at {DEFAULT_DIMENSIONS[bedType].width_cm}×{DEFAULT_DIMENSIONS[bedType].length_cm}cm -
            drag/resize after creating.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
