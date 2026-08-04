import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { RadioToggleGroup } from "@/components/ui/toggle-group";
import { useSnackbar } from "@/components/Snackbar";
import {
  createHarvestLog,
  updateAction,
  type Action,
  type HarvestLog,
  type HarvestQuality,
  type Planting,
} from "@/api/client";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";

const QUALITY_OPTIONS: { value: HarvestQuality | ""; label: string }[] = [
  { value: "", label: "Not rated" },
  { value: "poor", label: "Poor" },
  { value: "fair", label: "Fair" },
  { value: "good", label: "Good" },
  { value: "excellent", label: "Excellent" },
];

type HarvestProgress = "more" | "final";

/** One shared harvest-logging form (#221), opened from both `TaskDetail.tsx`
 * (a `harvest`-type task's own detail page) and `MobileLogging.tsx` (its
 * flat list of open harvest tasks) - identical behavior regardless of
 * entry point, per the ticket's own design spec. Always creates a
 * `HarvestLog` row on submit; whether the underlying `Action` also gets
 * marked `completed` is a second, explicit in-form choice ("More to come"
 * vs. "This is the last harvest"), not inferred from the amount entered -
 * a crop like strawberries gets picked a little at a time over many days
 * from the same task (see the ticket's own Dave-journey source quotes).
 *
 * Planting resolution (which `Planting` this task's `HarvestLog.
 * planting_id` should point at) is the caller's job, not this
 * component's - `TaskDetail.tsx` needs the same resolution for its own
 * harvest-history list beneath this dialog's trigger, so doing it once in
 * the caller (via `harvestPlanting.ts`'s `resolveHarvestPlanting`) avoids
 * two independent copies of the same lookup. This component only renders
 * the disabled state's own explanatory text; it doesn't compute it. */
export function HarvestLogDialog({
  action,
  planting,
  disabledReason,
  plantCommonName,
  bedName,
  triggerLabel = "Log a harvest",
}: {
  action: Action;
  planting: Planting | null;
  disabledReason: string | null;
  plantCommonName: string;
  bedName: string;
  triggerLabel?: string;
}) {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [quality, setQuality] = useState<HarvestQuality | "">("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<HarvestProgress>("more");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayIsoDate());
    setAmount("");
    setUnit("");
    setQuality("");
    setNotes("");
    setProgress("more");
    setValidationError(null);
  }, [open]);

  // Both requests live in one mutationFn (not split between mutationFn and
  // onSuccess) so a failure in *either* step - creating the log, or the
  // follow-up "mark task done" PATCH - correctly surfaces as this
  // mutation's own isError/error state, per the ticket's "on error (either
  // request fails), keep the dialog open" requirement. An onSuccess-time
  // await's own rejection wouldn't be caught by useMutation's error
  // handling the way a mutationFn's own rejection is.
  const logMutation = useMutation({
    mutationFn: async (): Promise<HarvestLog> => {
      const created = await createHarvestLog({
        planting_id: planting?.id as number,
        harvest_date: date,
        yield_amount: amount.trim() ? Number(amount) : null,
        yield_unit: unit.trim() || null,
        quality: quality || null,
        notes: notes.trim(),
      });
      if (progress === "final" && action.id != null) {
        await updateAction(action.id, { status: "completed", completed_date: todayIsoDate() });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harvest-logs", planting?.id] });
      queryClient.invalidateQueries({ queryKey: ["action", action.id] });
      queryClient.invalidateQueries({ queryKey: ["actions"] });
      show(progress === "final" ? "Harvest logged — task marked done" : "Harvest logged");
      setOpen(false);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);
    if (!amount.trim() && !quality && !notes.trim()) {
      setValidationError("Add at least an amount or a note.");
      return;
    }
    if (!planting) return;
    logMutation.mutate();
  }

  if (disabledReason) {
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" disabled>
          {triggerLabel}
        </Button>
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <DialogTitle className="text-base font-medium">
              Log a harvest — {plantCommonName} ({bedName})
            </DialogTitle>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Amount</span>
                <Input
                  type="number"
                  variant="numeric"
                  step="0.1"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Unit</span>
                <Input placeholder="kg, count, bunches…" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </label>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Quality</span>
              <RadioToggleGroup<HarvestQuality | "">
                ariaLabel="Harvest quality"
                value={quality}
                onChange={setQuality}
                options={QUALITY_OPTIONS}
              />
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Notes</span>
              <Textarea
                rows={3}
                placeholder='e.g. "smaller than usual this year"'
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            <div className="flex flex-col gap-1 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">More to come, or is this it?</span>
              <RadioToggleGroup<HarvestProgress>
                ariaLabel="Harvest status"
                value={progress}
                onChange={setProgress}
                options={[
                  { value: "more", label: "More to come" },
                  { value: "final", label: "This is the last harvest" },
                ]}
              />
            </div>

            {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            {logMutation.isError && (
              <p className="text-sm text-destructive">
                {logMutation.error instanceof Error ? logMutation.error.message : "Failed to log harvest"}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={logMutation.isPending}>
                {logMutation.isPending
                  ? "Logging…"
                  : progress === "final"
                    ? "Log harvest & mark task done"
                    : "Log harvest"}
              </Button>
            </div>
          </form>
        </Card>
      </DialogPopup>
    </Dialog>
  );
}
