import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listActions, listBedEquipment, listBeds, listPlants, type Action, type Bed, type BedEquipment, type Plant } from "@/api/client";
import { SnoozeDialog } from "./SnoozeDialog";
import { ACTION_TYPE_LABELS, formatDueDateHeading, groupActionsByDueDate, isSnoozed, sortedDueDates, taskLabel } from "./taskAgenda";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";

/** One task's own row - the tap-through `Link` and the snooze quick action
 * as *siblings*, not nested (an interactive control inside a `Link` is
 * invalid HTML and breaks keyboard/screen-reader activation - same
 * principle #224's own hero-card spec already called out). Icon-only
 * snooze button, `aria-label` carrying the accessible name - matches the
 * existing icon-button convention elsewhere in this app. */
function TaskRow({
  action,
  plantsBySlug,
  bedsById,
  equipmentById,
}: {
  action: Action;
  plantsBySlug: Map<string, Plant>;
  bedsById: Map<number, Bed>;
  equipmentById: Map<number, BedEquipment>;
}) {
  const snoozed = isSnoozed(action, todayIsoDate());
  return (
    <div className="flex items-center justify-between gap-2">
      <Link to={`/tasks/${action.id}`} className="text-sm underline-offset-2 hover:underline">
        {taskLabel(action, plantsBySlug, bedsById, equipmentById)}
        {snoozed && <span className="ml-2 text-xs text-muted-foreground">Snoozed until {action.snoozed_until}</span>}
      </Link>
      <SnoozeDialog
        action={action}
        taskLabel={ACTION_TYPE_LABELS[action.action_type] ?? action.action_type}
        trigger={
          <Button size="xs" variant="ghost" aria-label={snoozed ? "Change snooze" : "Snooze reminder"}>
            <Clock className="size-3.5" />
          </Button>
        }
      />
    </div>
  );
}

/** Day-cell agenda of garden tasks (#181) - every `pending` `Action` row,
 * grouped by its own due window's end date (`due_date_end`, the "must
 * finish before" deadline - see `taskAgenda.ts`'s `taskDueDateKey`), each
 * one linking through to its own detail page (`TaskDetail.tsx`, at
 * `/tasks/:id`). Originally a standalone section rendered directly on
 * `Agenda.tsx`/`MobileAgenda.tsx`; now List mode inside `CalendarView.tsx`
 * (#29), rendered completely unmodified - Month/Week/Day modes cover the
 * "browse a real calendar grid, everything regardless of status" case,
 * this one stays the "what's actually due, pending-only, right now" flat
 * list it always was. */
export function TaskAgendaView() {
  const actionsQuery = useQuery({ queryKey: ["actions"], queryFn: () => listActions() });
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const equipmentQuery = useQuery({ queryKey: ["bed-equipment"], queryFn: listBedEquipment });

  const isPending = actionsQuery.isPending || bedsQuery.isPending || plantsQuery.isPending || equipmentQuery.isPending;
  const isError = actionsQuery.isError || bedsQuery.isError || plantsQuery.isError || equipmentQuery.isError;

  if (isPending) return <p className="text-sm text-muted-foreground">Loading tasks…</p>;
  if (isError) return <p className="text-sm text-destructive">Failed to load tasks.</p>;

  const bedsById = new Map((bedsQuery.data ?? []).filter((b) => b.id != null).map((b) => [b.id as number, b]));
  const plantsBySlug = new Map((plantsQuery.data ?? []).map((p) => [p.slug, p]));
  const equipmentById = new Map((equipmentQuery.data ?? []).filter((e) => e.id != null).map((e) => [e.id as number, e]));

  // Only pending tasks - an "agenda" of things still to do, not a log of
  // everything ever generated. Completed/skipped tasks stay reachable via
  // their own detail page link (once something else links to them - e.g.
  // the future timeline view, #182) rather than needing a place here.
  const pendingActions = (actionsQuery.data ?? []).filter((a) => a.status === "pending");
  const byDate = groupActionsByDueDate(pendingActions);
  const dates = sortedDueDates(byDate);

  if (dates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tasks due yet - tasks generated from your plantings, beds, and equipment will show up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {dates.map((date) => (
        <Card key={date}>
          <CardHeader>
            <CardTitle className="text-sm">{formatDueDateHeading(date)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {(byDate.get(date) ?? []).map((action) => (
              <TaskRow
                key={action.id}
                action={action}
                plantsBySlug={plantsBySlug}
                bedsById={bedsById}
                equipmentById={equipmentById}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
