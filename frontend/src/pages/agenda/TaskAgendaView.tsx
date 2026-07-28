import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listActions, listBedEquipment, listBeds, listPlants, type Action, type Bed, type BedEquipment, type Plant } from "@/api/client";
import { ACTION_TYPE_LABELS, groupActionsByDueDate, sortedDueDates } from "./taskAgenda";

/** "Tuesday, July 28, 2026" - day-level, so a locale-aware `Date` format
 * reads better than hand-rolling one the way `agendaMonths.ts`'s
 * month-only `MONTH_NAMES` does (a plain month name has no such
 * locale-formatting ambiguity to begin with). Parsed as local midnight
 * (`T00:00:00`, no timezone suffix) so the displayed date matches the
 * plain `YYYY-MM-DD` string everywhere else in this app, regardless of the
 * browser's own timezone. */
function formatDueDateHeading(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** "Sow — Tomato (North planter)" - the action type plus whichever of
 * plant/bed/equipment it references, in that order, joined only by the
 * pieces actually present (an action isn't required to reference any of
 * them - see `Action`'s own doc on its four nullable FKs). */
function taskLabel(
  action: Action,
  plantsBySlug: Map<string, Plant>,
  bedsById: Map<number, Bed>,
  equipmentById: Map<number, BedEquipment>,
): string {
  const typeLabel = ACTION_TYPE_LABELS[action.action_type] ?? action.action_type;
  const plantLabel = action.plant_slug ? (plantsBySlug.get(action.plant_slug)?.common_name ?? action.plant_slug) : null;
  const bedLabel = action.bed_id != null ? (bedsById.get(action.bed_id)?.name ?? `Bed #${action.bed_id}`) : null;
  const equipmentLabel =
    action.equipment_id != null
      ? (equipmentById.get(action.equipment_id)?.equipment_type ?? `Equipment #${action.equipment_id}`)
      : null;
  const refs = [plantLabel, bedLabel, equipmentLabel].filter((r): r is string => !!r);
  return refs.length > 0 ? `${typeLabel} — ${refs.join(", ")}` : typeLabel;
}

/** Day-cell agenda of garden tasks (#181) - every `pending` `Action` row,
 * grouped by its own due window's end date (`due_date_end`, the "must
 * finish before" deadline - see `taskAgenda.ts`'s `taskDueDateKey`), each
 * one linking through to its own detail page (`TaskDetail.tsx`, at
 * `/tasks/:id`). Deliberately a *second*, separate section alongside the
 * existing `AgendaView.tsx` (sowing/harvest *windows* derived from active
 * plantings' `PlantPeriod` data) rather than replacing or merging into it -
 * that view answers "what's coming up over the season," this one answers
 * "what's actually due, right now" from real generated tasks (#183/#192);
 * reconciling the two into one unified calendar is a materially bigger
 * design question this ticket's own scope doesn't ask for (see #197's/
 * this ticket's own note flagging it as an open implementation call).
 * Shared between the desktop `/agenda` route and the mobile route set's
 * own Agenda tab, matching `AgendaView`'s existing sharing pattern - plain
 * Tailwind/shadcn list UI, nothing canvas-editor-specific here either. */
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
              <Link
                key={action.id}
                to={`/tasks/${action.id}`}
                className="text-sm underline-offset-2 hover:underline"
              >
                {taskLabel(action, plantsBySlug, bedsById, equipmentById)}
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
