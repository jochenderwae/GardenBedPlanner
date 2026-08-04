import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioToggleGroup } from "@/components/ui/toggle-group";
import { useSnackbar } from "@/components/Snackbar";
import { updateAction, type Action } from "@/api/client";
import { addDaysToIsoDate, todayIsoDate } from "@/pages/layout/plantingLifecycle";

type Preset = "tomorrow" | "weekend" | "next_week" | "custom";

/** The upcoming Saturday strictly after `todayIso` - mirrors
 * `backend/app/services/reminders.py`'s own `next_saturday` exactly
 * (same "strictly after, never today" reasoning: snoozing to the current
 * day would be a no-op). JS `Date.getUTCDay()` is Sunday=0…Saturday=6. */
function nextSaturdayIso(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  return addDaysToIsoDate(todayIso, daysUntilSaturday);
}

/** The Monday that starts the *following* calendar week - strictly after
 * this week's own Monday (so a snooze set on a Monday resolves to next
 * week, not a same-day no-op), same reasoning as `nextSaturdayIso` above. */
function nextWeekMondayIso(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const mondayIndex = (dayOfWeek + 6) % 7; // Monday=0 ... Sunday=6
  const daysUntilMonday = (7 - mondayIndex) % 7 || 7;
  return addDaysToIsoDate(todayIso, daysUntilMonday);
}

/** "Tomorrow" / "This weekend" (or "Next weekend" if today already is
 * Saturday - a button targeting "today" would be a no-op) / "Next week" -
 * plain-language label per preset, resolved against `todayIso` so the
 * weekend label stays meaningful regardless of which day this renders on. */
function presetLabel(preset: Preset, todayIso: string): string {
  if (preset === "tomorrow") return "Tomorrow";
  if (preset === "weekend") {
    const [y, m, d] = todayIso.split("-").map(Number);
    const isSaturday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
    return isSaturday ? "Next weekend" : "This weekend";
  }
  if (preset === "next_week") return "Next week";
  return "Custom date";
}

function resolvePreset(preset: Preset, todayIso: string, customDate: string): string | null {
  if (preset === "tomorrow") return addDaysToIsoDate(todayIso, 1);
  if (preset === "weekend") return nextSaturdayIso(todayIso);
  if (preset === "next_week") return nextWeekMondayIso(todayIso);
  return customDate || null;
}

function formatSnoozedUntil(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface SnoozeDialogProps {
  action: Action;
  taskLabel: string;
  trigger: ReactElement;
}

/** Shared snooze picker (#230/#231) - one component behind three different
 * trigger elements (`TaskDetail.tsx`'s "Snooze"/"Change" buttons,
 * `TaskAgendaView.tsx`'s icon-only per-row quick action, `MobileHome.tsx`'s
 * hero-task "Snooze" button), so the preset/custom-date logic lives once.
 * `trigger` is a caller-supplied element (not a fixed button) so each entry
 * point keeps its own styling/icon/label while sharing the picker itself. */
export function SnoozeDialog({ action, taskLabel, trigger }: SnoozeDialogProps) {
  const queryClient = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("tomorrow");
  const [customDate, setCustomDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = todayIsoDate();
  const minCustomDate = addDaysToIsoDate(today, 1);

  useEffect(() => {
    if (!open) return;
    // No preset pre-selected on a "Change" (re-open while already
    // snoozed) - there's no reliable way to tell which preset a stored
    // date came from, and guessing wrong is worse than defaulting to
    // "Tomorrow" reading as chosen when it wasn't. Still defaults the
    // *radio control itself* to "tomorrow" (a radiogroup needs some
    // value), the user just hasn't consciously picked it yet either way.
    setPreset("tomorrow");
    setCustomDate("");
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (snoozedUntil: string) => updateAction(action.id as number, { snoozed_until: snoozedUntil }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["action", action.id], updated);
      queryClient.invalidateQueries({ queryKey: ["actions"] });
      setOpen(false);
      const previous = action.snoozed_until;
      showSnackbar(`Reminder snoozed until ${formatSnoozedUntil(updated.snoozed_until as string)}`, () => {
        updateAction(action.id as number, { snoozed_until: previous }).then((reverted) => {
          queryClient.setQueryData(["action", action.id], reverted);
          queryClient.invalidateQueries({ queryKey: ["actions"] });
        });
      });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to snooze reminder"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const resolved = resolvePreset(preset, today, customDate);
    if (!resolved) {
      setError("Choose a date.");
      return;
    }
    mutation.mutate(resolved);
  }

  const presetOptions: { value: Preset; label: string }[] = (["tomorrow", "weekend", "next_week", "custom"] as Preset[]).map(
    (value) => ({ value, label: presetLabel(value, today) }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <DialogTitle className="text-base font-medium">Snooze reminder — {taskLabel}</DialogTitle>

            {action.snoozed_until && (
              <p className="text-sm text-muted-foreground">Currently snoozed until {formatSnoozedUntil(action.snoozed_until)}.</p>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Snooze until</span>
              <RadioToggleGroup<Preset>
                ariaLabel="Snooze duration"
                value={preset}
                onChange={setPreset}
                options={presetOptions}
                className="flex-wrap"
              />
            </div>

            {preset === "custom" && (
              <label className="flex flex-col gap-1" htmlFor="snooze-field-custom-date">
                <span className="text-xs font-medium text-muted-foreground">Date</span>
                <Input
                  id="snooze-field-custom-date"
                  type="date"
                  min={minCustomDate}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </label>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? "Snoozing…" : "Snooze"}
              </Button>
            </div>
          </form>
        </Card>
      </DialogPopup>
    </Dialog>
  );
}
