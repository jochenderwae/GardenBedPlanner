import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle, Clock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSnackbar } from "@/components/Snackbar";
import { cn } from "@/lib/utils";
import { listActions, listBedEquipment, listBeds, listPlants, updateAction, type Action } from "@/api/client";
import { SnoozeDialog } from "@/pages/agenda/SnoozeDialog";
import { sortByUrgency, taskLabel } from "@/pages/agenda/taskAgenda";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";

const ACTIONS_QUERY_KEY = ["actions", "actionable-now"];

/** "Overdue — was due 2026-07-20" (destructive) / "Due by 2026-08-01" (muted)
 * / "Since 2026-07-15" (muted, only when the window has opened but has no
 * end date at all - see #181's own doc on why a task like `thin` can lack
 * one). Kept local to this view rather than sharing `TaskDetail.tsx`'s or
 * `TimelineDetailPanel.tsx`'s own `formatDueWindow` - neither of those
 * distinguishes overdue-vs-not, which this ticket's own design spec
 * requires, and both are already independent per-view copies rather than a
 * single shared implementation. */
function dueWindowText(action: Action, today: string): { text: string; overdue: boolean } {
  if (action.due_date_end) {
    if (action.due_date_end < today) {
      return { text: `Overdue — was due ${action.due_date_end}`, overdue: true };
    }
    return { text: `Due by ${action.due_date_end}`, overdue: false };
  }
  return { text: `Since ${action.due_date_start}`, overdue: false };
}

function DueWindow({ action, today }: { action: Action; today: string }) {
  const due = dueWindowText(action, today);
  return (
    <span className={cn("text-xs", due.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
      {due.text}
    </span>
  );
}

/** The single most urgent task, larger treatment - two deliberately separate
 * rows (tap-through link, then a quick-action button) rather than one big
 * clickable card with a nested button, since an interactive control inside
 * a `Link` is invalid HTML and breaks keyboard/screen-reader activation
 * (see this ticket's own Design specification). */
function HeroTask({
  action,
  label,
  today,
  onMarkDone,
  isMutating,
}: {
  action: Action;
  label: string;
  today: string;
  onMarkDone: (action: Action) => void;
  isMutating: boolean;
}) {
  const isHarvest = action.action_type === "harvest";
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Link to={`/tasks/${action.id}`} className="flex flex-col gap-1">
        <span className="text-base font-medium">{label}</span>
        <DueWindow action={action} today={today} />
      </Link>
      {/* #231: Snooze is orthogonal to the harvest-vs-other-type branch
          below - both variants still get it, as a second quick-action
          button in the same row. Deliberately hero-only, not offered on
          the secondary rows below (#224's own spec kept those tap-through
          only to preserve the hero's visual weight - adding a quick action
          there would undermine that same reasoning). */}
      <div className="flex gap-2">
        {isHarvest ? (
          // #221: a harvest task can't be one-tap "done" - completing it
          // requires the partial/final decision and a HarvestLog entry, which
          // only TaskDetail's HarvestLogDialog flow can do.
          <Link to={`/tasks/${action.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Log harvest
          </Link>
        ) : (
          <Button variant="outline" size="sm" disabled={isMutating} onClick={() => onMarkDone(action)}>
            Mark done
          </Button>
        )}
        <SnoozeDialog
          action={action}
          taskLabel={label}
          trigger={
            <Button variant="outline" size="sm">
              <Clock /> Snooze
            </Button>
          }
        />
      </div>
    </Card>
  );
}

/** Next up to 4 tasks - plain compact rows (no per-row `Card`, no
 * quick-action button) so the visual weight stays clearly behind the hero. */
function SecondaryTaskRow({ action, label, today }: { action: Action; label: string; today: string }) {
  return (
    <Link
      to={`/tasks/${action.id}`}
      className="flex items-center justify-between gap-3 border-t pt-2 text-sm first:border-t-0 first:pt-0 hover:underline"
    >
      <span>{label}</span>
      <span className="shrink-0">
        <DueWindow action={action} today={today} />
      </span>
    </Link>
  );
}

/** Mobile Home tab (#224) - "what's the single most useful thing I can do
 * right now," not the full agenda. One hero task (closest deadline) plus up
 * to 4 more in a compact secondary list, sorted `due_date_end` ascending
 * (`sortByUrgency`, the same "closest deadline first" convention
 * `taskAgenda.ts`/the backend's own `actionable_now` filter already use).
 * Tasks the user just snoozed (#230/#231) are excluded client-side before
 * ranking - the backend's own `actionable_now` filtering is untouched, a
 * snoozed task still shows up normally everywhere else (agenda, timeline,
 * task detail) - see #231's cross-reference comment on this ticket. */
export function MobileHome() {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const today = todayIsoDate();
  const [mutatingIds, setMutatingIds] = useState<Set<number>>(new Set());

  const actionsQuery = useQuery({ queryKey: ACTIONS_QUERY_KEY, queryFn: () => listActions({ actionableNow: true }) });
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const equipmentQuery = useQuery({ queryKey: ["bed-equipment"], queryFn: listBedEquipment });

  const isPending = actionsQuery.isPending || bedsQuery.isPending || plantsQuery.isPending || equipmentQuery.isPending;
  const isError = actionsQuery.isError || bedsQuery.isError || plantsQuery.isError || equipmentQuery.isError;

  const bedsById = new Map((bedsQuery.data ?? []).filter((b) => b.id != null).map((b) => [b.id as number, b]));
  const plantsBySlug = new Map((plantsQuery.data ?? []).map((p) => [p.slug, p]));
  const equipmentById = new Map((equipmentQuery.data ?? []).filter((e) => e.id != null).map((e) => [e.id as number, e]));

  const eligible = (actionsQuery.data ?? []).filter((a) => !(a.snoozed_until && a.snoozed_until >= today));
  const sorted = sortByUrgency(eligible);
  const hero = sorted[0] as Action | undefined;
  const secondary = sorted.slice(1, 5);
  const remainder = Math.max(0, sorted.length - 5);

  function markDone(action: Action) {
    if (action.id == null) return;
    const id = action.id;
    const previous = queryClient.getQueryData<Action[]>(ACTIONS_QUERY_KEY);
    setMutatingIds((ids) => new Set(ids).add(id));
    queryClient.setQueryData<Action[]>(ACTIONS_QUERY_KEY, (old) => (old ?? []).filter((a) => a.id !== id));
    updateAction(id, { status: "completed", completed_date: today })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["actions"] });
        show("Marked done", () => {
          updateAction(id, { status: "pending", completed_date: null }).then(() =>
            queryClient.invalidateQueries({ queryKey: ["actions"] }),
          );
        });
      })
      .catch(() => {
        queryClient.setQueryData<Action[]>(ACTIONS_QUERY_KEY, previous);
        show("Failed to mark done - try again.");
      })
      .finally(() => {
        setMutatingIds((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
      });
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-base font-semibold">Home</h1>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load tasks.</p>}

      {!isPending && !isError && !hero && (
        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <CheckCircle className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">All caught up — nothing urgent right now.</p>
          <Link to="/agenda" className={buttonVariants({ variant: "outline", size: "sm" })}>
            View full agenda
          </Link>
        </Card>
      )}

      {!isPending && !isError && hero && (
        <>
          <HeroTask
            action={hero}
            label={taskLabel(hero, plantsBySlug, bedsById, equipmentById)}
            today={today}
            onMarkDone={markDone}
            isMutating={hero.id != null && mutatingIds.has(hero.id)}
          />

          {secondary.length > 0 && (
            <Card className="flex flex-col gap-2 p-3">
              {secondary.map((action) => (
                <SecondaryTaskRow
                  key={action.id}
                  action={action}
                  label={taskLabel(action, plantsBySlug, bedsById, equipmentById)}
                  today={today}
                />
              ))}
            </Card>
          )}

          {remainder > 0 && (
            <Link to="/agenda" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              {remainder} more due — view Agenda
            </Link>
          )}
        </>
      )}
    </div>
  );
}
