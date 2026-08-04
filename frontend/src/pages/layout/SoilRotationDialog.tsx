import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Plus, RefreshCw, RotateCw, Trash2, X } from "lucide-react";
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
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useSnackbar } from "@/components/Snackbar";
import { createSoilRotationEvent, type Bed } from "@/api/client";
import { todayIsoDate } from "./plantingLifecycle";

/** Sentinel "From" option value for "fresh/external soil, no source bed" -
 * same sentinel-option convention `EquipmentPanel.tsx`'s own
 * `PLACE_IN_GARDEN_VALUE` already uses for "a choice that isn't a real bed
 * id." */
const FRESH_SOIL_VALUE = "__fresh__";

interface Leg {
  from: string;
  to: string;
}

/** Every bed already used as some *other* leg's "To" - a bed can only be a
 * rotation's destination once (see `SoilRotationDialog`'s own doc on why
 * this is enforced by constraining the option list, not a validation
 * error). */
function usedAsDestination(legs: Leg[], excludeIndex: number, bedId: number): boolean {
  return legs.some((leg, i) => i !== excludeIndex && leg.to === String(bedId));
}

/** "Bed A's soil" / "Fresh soil" - the source half of one leg's plain-
 * language summary line. */
function fromLabel(leg: Leg, bedsById: Map<number, Bed>): string {
  if (leg.from === FRESH_SOIL_VALUE) return "Fresh soil";
  const bed = bedsById.get(Number(leg.from));
  return bed ? `${bed.name}'s soil` : "Unknown bed's soil";
}

/** One bullet line per *valid* leg (both From and To set) - an in-progress
 * blank leg just doesn't contribute a line yet. Shared by the live preview
 * (always visible below the leg list) and the submit-time AlertDialog's own
 * description, so what the user confirms is exactly what they already
 * reviewed. */
function summaryLines(legs: Leg[], bedsById: Map<number, Bed>): string[] {
  return legs
    .filter((leg) => leg.from && leg.to)
    .map((leg) => `${fromLabel(leg, bedsById)} → ${bedsById.get(Number(leg.to))?.name ?? "Unknown bed"}`);
}

interface SoilRotationDialogProps {
  beds: Bed[];
}

/** "Log soil rotation" (#228/#229) - records an N-way soil-transfer cycle
 * between beds (A's soil moves into B, B's into C, ... possibly closing
 * back to A, or with one edge being fresh/external soil rather than a
 * source bed) as one `SoilRotationEvent` with N `SoilRotationTransfer`
 * edges. A plain ordered "leg" list, not a node-graph canvas like #209's
 * `PipeNetworkDialog` - beds are a small, fixed, already-named set (no
 * "create a new node" step) and real practice is an ordered chain/cycle,
 * not an arbitrary graph. Leg order is a pure building convenience (it
 * seeds "+ Add leg"'s prefill and "Close the loop"'s target) - the backend
 * model carries no ordering field, so nothing about list position is ever
 * sent.
 *
 * Self-transfer and duplicate-destination are prevented *by construction*
 * (each leg's own "To" options exclude that leg's own "From" bed and any
 * bed already claimed as another leg's "To") rather than caught after the
 * fact with inline error text - see `usedAsDestination` above.
 *
 * No `PATCH`/`DELETE` exists on a logged event (a historical fact, not
 * something this UI lets you edit afterward), so submit goes through an
 * `AlertDialog` confirm step showing the exact same plain-language summary
 * as the live preview - the one chance to catch a mistake before it's
 * permanent. */
export function SoilRotationDialog({ beds }: SoilRotationDialogProps) {
  const { show: showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eventDate, setEventDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [legs, setLegs] = useState<Leg[]>([{ from: "", to: "" }]);
  const [error, setError] = useState<string | null>(null);

  const bedsById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b]));

  useEffect(() => {
    if (!open) return;
    setEventDate(todayIsoDate());
    setNotes("");
    setLegs([{ from: "", to: "" }]);
    setError(null);
    setConfirmOpen(false);
  }, [open]);

  function updateLeg(index: number, patch: Partial<Leg>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  function removeLeg(index: number) {
    setLegs((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function addLeg() {
    setLegs((prev) => [...prev, { from: prev[prev.length - 1]?.to ?? "", to: "" }]);
  }

  const firstLegFromBedId = legs[0]?.from && legs[0].from !== FRESH_SOIL_VALUE ? legs[0].from : null;
  const canCloseLoop =
    legs.length >= 2 && firstLegFromBedId != null && !legs.some((leg) => leg.to === firstLegFromBedId);

  function closeLoop() {
    if (!firstLegFromBedId) return;
    setLegs((prev) => [...prev, { from: prev[prev.length - 1]?.to ?? "", to: firstLegFromBedId }]);
  }

  const validLegs = legs.filter((leg) => leg.from && leg.to);
  const isValid = legs.length > 0 && validLegs.length === legs.length;
  const preview = summaryLines(legs, bedsById);

  const mutation = useMutation({
    mutationFn: () =>
      createSoilRotationEvent({
        event_date: eventDate,
        notes: notes.trim(),
        transfers: validLegs.map((leg) => ({
          from_bed_id: leg.from === FRESH_SOIL_VALUE ? null : Number(leg.from),
          to_bed_id: Number(leg.to),
        })),
      }),
    onSuccess: () => {
      setConfirmOpen(false);
      setOpen(false);
      showSnackbar("Soil rotation logged");
    },
    onError: (err: unknown) => {
      // Falls back to the form dialog (still open, every field intact),
      // not lost entirely - the confirm step is the only thing that closes.
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : "Failed to log soil rotation");
    },
  });

  function requestSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setError(null);
    setConfirmOpen(true);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" variant="outline" disabled={beds.length === 0}>
            <RefreshCw /> Log soil rotation
          </Button>
        }
      />
      <DialogPopup>
        <Card className="w-full max-w-md p-4">
          <form className="flex flex-col gap-3" onSubmit={requestSubmit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-medium">Log soil rotation</DialogTitle>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>

            <label className="flex flex-col gap-1" htmlFor="soil-rotation-field-date">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <Input id="soil-rotation-field-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2 text-xs font-medium text-muted-foreground">
                <span className="w-5" />
                <span className="flex-1">From</span>
                <span className="w-4" />
                <span className="flex-1">To</span>
                <span className="w-7" />
              </div>
              {legs.map((leg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
                  <Select
                    className="flex-1"
                    aria-label={`Leg ${i + 1} source`}
                    value={leg.from}
                    onChange={(e) => updateLeg(i, { from: e.target.value })}
                  >
                    <option value="">Select a source…</option>
                    <option value={FRESH_SOIL_VALUE}>Fresh / external soil (no source)</option>
                    {beds.map((bed) => (
                      <option key={bed.id} value={String(bed.id)}>
                        {bed.name}
                      </option>
                    ))}
                  </Select>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <Select
                    className="flex-1"
                    aria-label={`Leg ${i + 1} destination`}
                    value={leg.to}
                    onChange={(e) => updateLeg(i, { to: e.target.value })}
                  >
                    <option value="">Select a destination…</option>
                    {beds
                      .filter((bed) => bed.id != null && String(bed.id) !== leg.from && !usedAsDestination(legs, i, bed.id as number))
                      .map((bed) => (
                        <option key={bed.id} value={String(bed.id)}>
                          {bed.name}
                        </option>
                      ))}
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove leg ${i + 1}`}
                    disabled={legs.length === 1}
                    onClick={() => removeLeg(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={addLeg}>
                <Plus /> Add leg
              </Button>
              {canCloseLoop && firstLegFromBedId && (
                <Button type="button" variant="ghost" size="sm" onClick={closeLoop}>
                  <RotateCw /> Close the loop back to {bedsById.get(Number(firstLegFromBedId))?.name}
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2">
              <span className="text-xs font-medium text-muted-foreground">This will move soil:</span>
              {preview.length === 0 ? (
                <p className="text-sm text-muted-foreground">Fill in at least one leg above.</p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-sm">
                  {preview.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>

            <label className="flex flex-col gap-1" htmlFor="soil-rotation-field-notes">
              <span className="text-xs font-medium text-muted-foreground">Notes</span>
              <Textarea
                id="soil-rotation-field-notes"
                rows={2}
                placeholder="e.g. why now, what you noticed"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!isValid}>
                Log rotation
              </Button>
            </div>
          </form>
        </Card>
      </DialogPopup>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogTitle>Log this soil rotation?</AlertDialogTitle>
          {/* The bullet summary is supplementary review content, not itself
              the dialog's accessible description - AlertDialogDescription
              below (base-ui's Description primitive) carries that role, and
              every other caller in this app only ever passes it plain text,
              so a block-level <ul> stays a sibling rather than nested
              inside it. */}
          <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
            {preview.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <AlertDialogDescription>
            This can't be edited or undone from here afterward - log it once the soil has actually been moved.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Logging…" : "Log rotation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Dialog>
  );
}
