import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deleteBed, updateBed, type Bed, type BedType, type BedUpdate } from "@/api/client";
import { BED_TYPE_LABELS } from "./geometry";

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const BED_TYPE_OPTIONS = Object.entries(BED_TYPE_LABELS) as [BedType, string][];

interface BedPanelProps {
  bed: Bed;
  onClose: () => void;
  onDeleted: () => void;
}

export function BedPanel({ bed, onClose, onDeleted }: BedPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(bed);

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
    setDraft((prev) => ({ ...prev, ...patch }));
    mutation.mutate(patch);
  }

  return (
    <Card className="w-72 p-4">
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
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <select
            className={inputClass}
            value={draft.bed_type}
            onChange={(e) => commit({ bed_type: e.target.value as BedType })}
          >
            {BED_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Width (cm)</span>
            <input
              type="number"
              className={inputClass}
              value={draft.width_cm}
              onChange={(e) => setDraft((prev) => ({ ...prev, width_cm: Number(e.target.value) }))}
              onBlur={() => draft.width_cm !== bed.width_cm && commit({ width_cm: draft.width_cm })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Length (cm)</span>
            <input
              type="number"
              className={inputClass}
              value={draft.length_cm}
              onChange={(e) => setDraft((prev) => ({ ...prev, length_cm: Number(e.target.value) }))}
              onBlur={() => draft.length_cm !== bed.length_cm && commit({ length_cm: draft.length_cm })}
            />
          </label>
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
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.has_greenhouse}
            onChange={(e) => commit({ has_greenhouse: e.target.checked })}
          />
          <span className="text-sm">Has greenhouse</span>
        </label>

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

        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (confirm(`Delete bed "${bed.name}"?`)) deleteMutation.mutate();
          }}
        >
          <Trash2 /> Delete bed
        </Button>
      </div>
    </Card>
  );
}
