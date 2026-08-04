import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { RulerDimensionLine } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getAction,
  getBed,
  getPlant,
  listActions,
  listBedEquipment,
  listHarvestLogs,
  listPlantings,
  updateAction,
  type Action,
  type ActionStatus,
  type HarvestLog,
  type HarvestQuality,
  type RecurrenceUnit,
} from "@/api/client";
import { ACTION_TYPE_LABELS } from "@/pages/agenda/taskAgenda";
import { HarvestLogDialog } from "@/pages/harvest/HarvestLogDialog";
import { harvestDisabledReason, resolveHarvestPlanting } from "@/pages/harvest/harvestPlanting";

/** "March 1 - May 31, 2026" for a real window, or just the one date when a
 * task collapses to a single day (a `clear` task, whose window is always
 * `due_date_start === due_date_end === Planting.removed_date` - see
 * `task_generation.py`'s own doc). `null` when neither end of the window
 * is set at all (a manually-created task with no computed window). */
function formatDueWindow(action: Action): string | null {
  if (!action.due_date_start && !action.due_date_end) return null;
  if (action.due_date_start === action.due_date_end) return action.due_date_start;
  if (!action.due_date_start) return `Due by ${action.due_date_end}`;
  if (!action.due_date_end) return `Not before ${action.due_date_start}`;
  return `${action.due_date_start} – ${action.due_date_end}`;
}

const RECURRENCE_UNIT_SINGULAR: Record<RecurrenceUnit, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

/** "Repeats every 3 weeks" / "Repeats every day" / "Repeats every 2 weeks
 * until 2026-12-31" (#227) - plain-language cadence for a manually-created
 * recurring task, mirroring `app/services/recurrence.py`'s own
 * `shift_date`/`generate_next_occurrence` semantics (interval + unit,
 * optional end date) without exposing those raw field names. */
function formatRecurrenceCadence(action: Action): string | null {
  if (!action.recurrence_unit) return null;
  const unitLabel = RECURRENCE_UNIT_SINGULAR[action.recurrence_unit];
  const cadence = action.recurrence_interval === 1 ? `every ${unitLabel}` : `every ${action.recurrence_interval} ${unitLabel}s`;
  return action.recurrence_end_date ? `Repeats ${cadence} until ${action.recurrence_end_date}` : `Repeats ${cadence}`;
}

const STATUS_LABELS: Record<ActionStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  skipped: "Skipped",
};

const HARVEST_QUALITY_LABELS: Record<HarvestQuality, string> = {
  poor: "Poor",
  fair: "Fair",
  good: "Good",
  excellent: "Excellent",
};

function formatHarvestDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "2.5 kg — Good — Jul 28, 2026" - amount+unit and quality are both
 * optional (#221's own minimal-validation rule only requires *one* of
 * amount/quality/notes), so each piece only joins in when present. */
function harvestLogSummary(log: HarvestLog): string {
  const parts: string[] = [];
  if (log.yield_amount != null) parts.push(`${log.yield_amount}${log.yield_unit ? ` ${log.yield_unit}` : ""}`);
  if (log.quality) parts.push(HARVEST_QUALITY_LABELS[log.quality]);
  parts.push(formatHarvestDate(log.harvest_date));
  return parts.join(" — ");
}

/** A single garden task's own detail view (#181) - the "click a task ->
 * see its detail" page the agenda (`TaskAgendaView.tsx`) and, eventually,
 * the timeline view (#182) both link a task diamond/list entry through to.
 * Read-only except for the one action a task detail view obviously needs
 * (marking it done/not-done, `Action.status` existing precisely for that) -
 * not a full per-field edit form, which nothing in this ticket's own scope
 * asked for. */
export function TaskDetail() {
  const { id } = useParams();
  const actionId = Number(id);
  const queryClient = useQueryClient();

  const actionQuery = useQuery({
    queryKey: ["action", actionId],
    queryFn: () => getAction(actionId),
    enabled: Number.isFinite(actionId),
  });
  const action = actionQuery.data;

  const bedQuery = useQuery({
    queryKey: ["bed", action?.bed_id],
    queryFn: () => getBed(action!.bed_id!),
    enabled: action?.bed_id != null,
  });
  const plantQuery = useQuery({
    queryKey: ["plant", action?.plant_slug],
    queryFn: () => getPlant(action!.plant_slug!),
    enabled: !!action?.plant_slug,
  });
  const equipmentQuery = useQuery({
    queryKey: ["bed-equipment"],
    queryFn: listBedEquipment,
    enabled: action?.equipment_id != null,
  });

  // #227: once this recurring task has been completed/skipped, #226's
  // backend generates its next occurrence (recurrence_source_action_id
  // pointing back at this one) - only worth fetching every action to find
  // it when this task is actually recurring at all (most tasks aren't).
  const isRecurring = action?.recurrence_unit != null;
  const actionsQuery = useQuery({ queryKey: ["actions"], queryFn: () => listActions(), enabled: isRecurring });
  const nextOccurrence = isRecurring ? (actionsQuery.data ?? []).find((a) => a.recurrence_source_action_id === action?.id) : undefined;

  // #221: harvest tasks specifically need their own Planting resolved (see
  // harvestPlanting.ts's own doc on why Action alone can't say which one) -
  // both for gating "Log a harvest" and for this planting's own harvest
  // history list below.
  const isHarvestTask = action?.action_type === "harvest";
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings, enabled: isHarvestTask });
  const { planting: harvestPlanting, matchCount: harvestMatchCount } =
    isHarvestTask && action ? resolveHarvestPlanting(plantingsQuery.data ?? [], action) : { planting: null, matchCount: 0 };
  const harvestLogsQuery = useQuery({
    queryKey: ["harvest-logs", harvestPlanting?.id],
    queryFn: () => listHarvestLogs(harvestPlanting?.id as number),
    enabled: harvestPlanting?.id != null,
  });

  // completed_date follows status here (rather than the other way around,
  // which updateAction's own backend route also supports via its
  // "set completed_date without status = mark completed" default) since
  // this button is explicitly "mark done/not done," not a date-entry form.
  const statusMutation = useMutation({
    mutationFn: (status: ActionStatus) =>
      updateAction(actionId, {
        status,
        completed_date: status === "completed" ? new Date().toISOString().slice(0, 10) : null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["action", actionId], updated);
      // #227: completing (or skipping) a recurring task may have just
      // generated its next occurrence server-side (#226) - the flat
      // ["actions"] list this page's own `actionsQuery` reads from (see
      // above) needs to refetch to pick that new row up, same "invalidate
      // after a status transition with wide-reaching effects" reasoning
      // HarvestLogDialog.tsx's own onSuccess already applies.
      queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });

  const equipment =
    action?.equipment_id != null ? equipmentQuery.data?.find((e) => e.id === action.equipment_id) : undefined;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/agenda" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
        {action && <h1 className="text-xl font-medium">{ACTION_TYPE_LABELS[action.action_type] ?? action.action_type}</h1>}
      </div>

      {actionQuery.isPending && <p className="text-sm text-muted-foreground">Loading task…</p>}
      {actionQuery.isError && <p className="text-sm text-destructive">Failed to load this task.</p>}

      {action && (
        <Card className="p-4">
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Status</dt>
              <dd className="flex items-center gap-2">
                {STATUS_LABELS[action.status]}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate(action.status === "completed" ? "pending" : "completed")}
                >
                  {action.status === "completed" ? "Mark pending" : "Mark complete"}
                </Button>
              </dd>
            </div>

            {formatDueWindow(action) && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Due</dt>
                <dd>{formatDueWindow(action)}</dd>
              </div>
            )}

            {action.completed_date && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Completed</dt>
                <dd>{action.completed_date}</dd>
              </div>
            )}

            {isRecurring && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Recurrence</dt>
                <dd>
                  {formatRecurrenceCadence(action)}
                  {nextOccurrence?.id != null && (
                    <>
                      {" — "}
                      <Link to={`/tasks/${nextOccurrence.id}`} className="underline underline-offset-2">
                        view next occurrence
                      </Link>
                    </>
                  )}
                </dd>
              </div>
            )}

            {action.plant_slug && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Plant</dt>
                <dd>
                  <Link to={`/plants/${action.plant_slug}`} className="underline underline-offset-2">
                    {plantQuery.data?.common_name ?? action.plant_slug}
                  </Link>
                </dd>
              </div>
            )}

            {action.bed_id != null && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Bed</dt>
                <dd className="flex items-center gap-2">
                  {bedQuery.data?.name ?? `Bed #${action.bed_id}`}
                  <Link
                    to={`/layout/beds/${action.bed_id}/technical-drawing`}
                    className={buttonVariants({ variant: "outline", size: "xs" })}
                  >
                    <RulerDimensionLine /> Technical drawing
                  </Link>
                </dd>
              </div>
            )}

            {action.equipment_id != null && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Equipment</dt>
                <dd>{equipment?.equipment_type ?? `Equipment #${action.equipment_id}`}</dd>
              </div>
            )}

            {action.notes && (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{action.notes}</dd>
              </div>
            )}
          </dl>

          {isHarvestTask && (
            <div className="mt-4 flex flex-col gap-3 border-t pt-3">
              <HarvestLogDialog
                action={action}
                planting={harvestPlanting}
                disabledReason={harvestDisabledReason(harvestMatchCount)}
                plantCommonName={plantQuery.data?.common_name ?? action.plant_slug ?? "this plant"}
                bedName={bedQuery.data?.name ?? `Bed #${action.bed_id}`}
              />

              <div>
                <span className="text-xs font-medium text-muted-foreground">Harvest log</span>
                {harvestLogsQuery.isPending && harvestPlanting && (
                  <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
                )}
                {(harvestLogsQuery.data ?? []).length === 0 && !harvestLogsQuery.isPending && (
                  <p className="mt-1 text-xs text-muted-foreground">No harvests logged yet for this planting.</p>
                )}
                <ul className="mt-1 flex flex-col gap-1">
                  {[...(harvestLogsQuery.data ?? [])]
                    .sort((a, b) => b.harvest_date.localeCompare(a.harvest_date))
                    .map((log) => (
                      <li key={log.id} className="text-xs">
                        {harvestLogSummary(log)}
                        {log.notes && <span className="block text-muted-foreground">"{log.notes}"</span>}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
