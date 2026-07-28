import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Action, Bed, PlantPeriod } from "@/api/client";
import { ACTION_TYPE_LABELS } from "@/pages/agenda/taskAgenda";
import type { TimelineRow } from "./timelineData";

const ACTION_STATUS_LABELS: Record<Action["status"], string> = {
  pending: "Pending",
  completed: "Completed",
  skipped: "Skipped",
};

/** The one thing selectable on the timeline at a time - a Gantt row's plant
 * label, one of its period bars, a task diamond (crop row or bed swimlane),
 * or a swimlane's own bed label. Mirrors `Layout.tsx`'s single
 * `selectedId`/`selectedPlantingId` pattern, just as one tagged union
 * instead of several parallel `useState`s, since this view (unlike
 * `Layout.tsx`) has no multi-select concept to keep separate. */
export type TimelineSelection =
  | { type: "planting"; row: TimelineRow }
  | { type: "period"; row: TimelineRow; period: PlantPeriod; periodTypeLabel: string }
  | { type: "task"; action: Action; contextLabel: string }
  | { type: "bed"; bed: Bed };

/** #182's own "simplified detail pane, with a link/button through to its
 * full detail page" design decision - reuses the same fixed-width
 * `overflow-y-auto`-bounded side-panel slot `BedPanel`/`PlantingPanel`
 * already use in `Layout.tsx`, per the design spec's Q3 answer (not an
 * anchored popover - no such primitive exists yet, and bars/diamonds can
 * sit near a scrolled-off edge of this wide grid - and not a full-view
 * replacement, which would lose the surrounding Gantt context on every
 * click). Read-only summary only; the actual entity editing already lives
 * on its own full page (`PlantDetail`, `TaskDetail`) or the canvas editor
 * (`Layout.tsx`) - this never duplicates that. */
export function TimelineDetailPanel({ selection, onClose }: { selection: TimelineSelection; onClose: () => void }) {
  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle>{titleFor(selection)}</CardTitle>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {selection.type === "planting" && <PlantingSummary row={selection.row} />}
        {selection.type === "period" && <PeriodSummary row={selection.row} period={selection.period} label={selection.periodTypeLabel} />}
        {selection.type === "task" && <TaskSummary action={selection.action} contextLabel={selection.contextLabel} />}
        {selection.type === "bed" && <BedSummary bed={selection.bed} />}
      </CardContent>
    </Card>
  );
}

function titleFor(selection: TimelineSelection): string {
  switch (selection.type) {
    case "planting":
      return selection.row.plant.common_name;
    case "period":
      return `${selection.periodTypeLabel} — ${selection.row.plant.common_name}`;
    case "task":
      return ACTION_TYPE_LABELS[selection.action.action_type] ?? selection.action.action_type;
    case "bed":
      return selection.bed.name;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function PlantingSummary({ row }: { row: TimelineRow }) {
  return (
    <dl className="flex flex-col gap-3">
      <Field label="Bed">{row.bed.name}</Field>
      {row.planting.planted_date && <Field label="Planted">{row.planting.planted_date}</Field>}
      {row.planting.removed_date && <Field label="Removed">{row.planting.removed_date}</Field>}
      <Link to={`/plants/${row.plant.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        View plant details
      </Link>
    </dl>
  );
}

function PeriodSummary({ row, period, label }: { row: TimelineRow; period: PlantPeriod; label: string }) {
  return (
    <dl className="flex flex-col gap-3">
      <Field label="Type">{label}</Field>
      <Field label="Window">
        {monthName(period.start_month)} – {monthName(period.end_month)}
      </Field>
      <Field label="Bed">{row.bed.name}</Field>
      <Link to={`/plants/${row.plant.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        View plant details
      </Link>
    </dl>
  );
}

function TaskSummary({ action, contextLabel }: { action: Action; contextLabel: string }) {
  return (
    <dl className="flex flex-col gap-3">
      <Field label="Status">{ACTION_STATUS_LABELS[action.status]}</Field>
      {(action.due_date_start || action.due_date_end) && (
        <Field label="Due">{formatDueWindow(action)}</Field>
      )}
      <Field label="Context">{contextLabel}</Field>
      {action.id != null && (
        <Link to={`/tasks/${action.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          View task details
        </Link>
      )}
    </dl>
  );
}

function BedSummary({ bed }: { bed: Bed }) {
  return (
    <dl className="flex flex-col gap-3">
      {bed.category && <Field label="Category">{bed.category}</Field>}
      <Link
        to={`/layout/beds/${bed.id}/technical-drawing`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        View technical drawing
      </Link>
    </dl>
  );
}

const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthName(month: number): string {
  return MONTH_NAMES_SHORT[month - 1] ?? String(month);
}

function formatDueWindow(action: Action): string {
  if (action.due_date_start === action.due_date_end) return action.due_date_start ?? "";
  if (!action.due_date_start) return `Due by ${action.due_date_end}`;
  if (!action.due_date_end) return `Not before ${action.due_date_start}`;
  return `${action.due_date_start} – ${action.due_date_end}`;
}
