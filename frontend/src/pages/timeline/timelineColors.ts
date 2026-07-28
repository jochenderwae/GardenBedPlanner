import type { ActionStatus } from "@/api/client";

/** `period_type` code -> one of the 5 categorical `--chart-*` Tailwind
 * tokens (`index.css`, given real hues by #188 - see that file's own
 * comment: "what #182's Gantt-view period bars ... use") - #182's own
 * design spec settled on coloring period bars by `period_type`. The 4
 * period types actually on file today (`sowing`/`planting`/`fertilizing`/
 * `harvesting`, see `GET /api/period-types`) each get their own slot;
 * `chart-5` is the spare slot the design spec called out, doubling as the
 * fallback for any future/unrecognized code rather than crashing or
 * silently reusing another type's color. */
const PERIOD_TYPE_CHART_CLASS: Record<string, string> = {
  sowing: "bg-chart-1",
  planting: "bg-chart-2",
  fertilizing: "bg-chart-3",
  harvesting: "bg-chart-4",
};
const PERIOD_TYPE_FALLBACK_CLASS = "bg-chart-5";

export function periodTypeChartClass(periodType: string): string {
  return PERIOD_TYPE_CHART_CLASS[periodType] ?? PERIOD_TYPE_FALLBACK_CLASS;
}

/** Task diamond styling by `ActionStatus`, not `action_type` - per the
 * design spec, "is this done" is the more useful at-a-glance signal on a
 * task marker than "what kind of task is this" (that's one hover/click
 * away). Deliberately not one of the `--chart-*` period-type colors, so a
 * diamond's status color never competes with its row's own bar color
 * scale. */
export const ACTION_STATUS_DIAMOND_CLASS: Record<ActionStatus, string> = {
  pending: "border-2 border-muted-foreground bg-background",
  completed: "border-2 border-primary bg-primary",
  skipped: "border border-muted-foreground/40 bg-muted opacity-50",
};
