import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { RadioToggleGroup } from "@/components/ui/toggle-group";
import { FieldHint } from "@/components/ui/tooltip";
import { PlantPicker } from "@/pages/layout/PlantPicker";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";
import {
  createAction,
  listBeds,
  listPlants,
  type Action,
  type ActionType,
  type Plant,
  type RecurrenceUnit,
} from "@/api/client";
import { ACTION_TYPE_LABELS } from "./taskAgenda";

type RepeatChoice = "one-off" | "recurring";

const RECURRENCE_UNIT_LABELS: Record<RecurrenceUnit, string> = {
  daily: "Day(s)",
  weekly: "Week(s)",
  monthly: "Month(s)",
  yearly: "Year(s)",
};

const ACTION_TYPE_OPTIONS = (Object.keys(ACTION_TYPE_LABELS) as ActionType[]).map((value) => ({
  value,
  label: ACTION_TYPE_LABELS[value],
}));

/** "New task" (#181/#227) - the app's first actual "create a task" UI;
 * before this, every `Action` row was either #192-auto-generated from a
 * planting/bed/equipment, or created directly via the API/tests.
 * `createAction` (`api/client.ts`) existed since #181 but had zero call
 * sites until now. Covers chores with no specific planting to hang off of -
 * compost bin turning, greenhouse maintenance, general bed upkeep.
 *
 * Rendered once inside `CalendarView.tsx` (shared unmodified by both
 * `Agenda.tsx` and `MobileAgenda.tsx` - see that file's own doc) rather than
 * duplicated per route, so the "reachable on both desktop and mobile"
 * requirement is satisfied by construction, not by two separate copies
 * needing to be kept in sync. */
export function NewTaskDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState<ActionType>("prepare_bed");
  const [bedId, setBedId] = useState("");
  const [armedPlant, setArmedPlant] = useState<Plant | null>(null);
  const [dueStart, setDueStart] = useState(todayIsoDate());
  const [dueEnd, setDueEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [repeat, setRepeat] = useState<RepeatChoice>("one-off");
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>("weekly");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Loaded on demand (only while the dialog is open) rather than unconditionally
  // like CalendarView's own bedsQuery/plantsQuery - List mode (where this
  // dialog is just as reachable as Month/Week/Day) doesn't otherwise need
  // either, per that component's own `enabled: mode !== "list"` gating.
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds, enabled: open });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500), enabled: open });

  useEffect(() => {
    if (!open) return;
    setActionType("prepare_bed");
    setBedId("");
    setArmedPlant(null);
    setDueStart(todayIsoDate());
    setDueEnd("");
    setNotes("");
    setRepeat("one-off");
    setRecurrenceUnit("weekly");
    setRecurrenceInterval("1");
    setRecurrenceEndDate("");
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      createAction({
        action_type: actionType,
        due_date_start: dueStart || null,
        due_date_end: dueEnd || null,
        completed_date: null,
        status: "pending",
        garden_plan_entry_id: null,
        bed_id: bedId ? Number(bedId) : null,
        plant_slug: armedPlant?.slug ?? null,
        equipment_id: null,
        depends_on_action_id: null,
        notes: notes.trim(),
        snoozed_until: null,
        recurrence_unit: repeat === "recurring" ? recurrenceUnit : null,
        recurrence_interval: repeat === "recurring" ? Math.max(1, Number(recurrenceInterval) || 1) : 1,
        recurrence_end_date: repeat === "recurring" && recurrenceEndDate ? recurrenceEndDate : null,
        recurrence_source_action_id: null,
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<Action[]>(["actions"], (old) => (old ? [...old, created] : [created]));
      // Every other actions query (["actions","calendar",...], ["actions",
      // "actionable-now"], ["actions","harvest-pending"], ...) keys off a
      // different filter than a plain setQueryData append can safely
      // update - invalidate the whole "actions" prefix so each refetches
      // and picks up the new task on its own terms.
      queryClient.invalidateQueries({ queryKey: ["actions"] });
      setOpen(false);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to create task"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Plus /> New task
          </Button>
        }
      />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-medium">New task</DialogTitle>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>

            <label className="flex flex-col gap-1" htmlFor="new-task-field-type">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Type
                <FieldHint description="What kind of task this is." />
              </span>
              <Select
                id="new-task-field-type"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as ActionType)}
              >
                {ACTION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="flex flex-col gap-1" htmlFor="new-task-field-bed">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Bed (optional)
                <FieldHint description="Which bed this task is about, if any - a general chore like greenhouse maintenance doesn't need one." />
              </span>
              <Select id="new-task-field-bed" value={bedId} onChange={(e) => setBedId(e.target.value)} disabled={bedsQuery.isPending}>
                <option value="">No specific bed</option>
                {(bedsQuery.data ?? []).map((bed) => (
                  <option key={bed.id} value={String(bed.id)}>
                    {bed.name}
                  </option>
                ))}
              </Select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Plant (optional)
                <FieldHint description="Which plant this task is about, if any." />
              </span>
              <PlantPicker
                plants={plantsQuery.data ?? []}
                armedPlant={armedPlant}
                onPick={(slug) => setArmedPlant((plantsQuery.data ?? []).find((p) => p.slug === slug) ?? null)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1" htmlFor="new-task-field-due-start">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  Due from
                  <FieldHint description="When this task's window opens - when it becomes something you can actually do." />
                </span>
                <Input id="new-task-field-due-start" type="date" value={dueStart} onChange={(e) => setDueStart(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1" htmlFor="new-task-field-due-end">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  Due by (optional)
                  <FieldHint description="The deadline this task is filed under in the agenda - leave blank for no fixed deadline." />
                </span>
                <Input id="new-task-field-due-end" type="date" value={dueEnd} onChange={(e) => setDueEnd(e.target.value)} />
              </label>
            </div>

            <label className="flex flex-col gap-1" htmlFor="new-task-field-notes">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Notes
                <FieldHint description="Any other notes about this task." />
              </span>
              <Textarea id="new-task-field-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            <div className="flex flex-col gap-1 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">Repeat?</span>
              <RadioToggleGroup<RepeatChoice>
                ariaLabel="Repeat"
                value={repeat}
                onChange={setRepeat}
                options={[
                  { value: "one-off", label: "One-off" },
                  { value: "recurring", label: "Repeating" },
                ]}
              />
            </div>

            {repeat === "recurring" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1" htmlFor="new-task-field-recurrence-interval">
                    <span className="text-xs font-medium text-muted-foreground">Every</span>
                    <Input
                      id="new-task-field-recurrence-interval"
                      type="number"
                      variant="numeric"
                      min="1"
                      value={recurrenceInterval}
                      onChange={(e) => setRecurrenceInterval(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1" htmlFor="new-task-field-recurrence-unit">
                    <span className="text-xs font-medium text-muted-foreground">&nbsp;</span>
                    <Select
                      id="new-task-field-recurrence-unit"
                      value={recurrenceUnit}
                      onChange={(e) => setRecurrenceUnit(e.target.value as RecurrenceUnit)}
                    >
                      {(Object.keys(RECURRENCE_UNIT_LABELS) as RecurrenceUnit[]).map((unit) => (
                        <option key={unit} value={unit}>
                          {RECURRENCE_UNIT_LABELS[unit]}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <label className="flex flex-col gap-1" htmlFor="new-task-field-recurrence-end">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    Until (optional)
                    <FieldHint description="Stop generating new occurrences after this date - leave blank to repeat indefinitely." />
                  </span>
                  <Input
                    id="new-task-field-recurrence-end"
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  />
                </label>
              </>
            )}

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
