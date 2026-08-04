import { TimelineView } from "@/pages/timeline/TimelineView";

/** A new season/year overview screen (#182) - a Gantt-style timeline of
 * every crop planting active in a selected year plus per-bed task
 * swimlanes, distinct from the day-cell/Month-Week-Day/List calendar of
 * `Action` rows (`Agenda.tsx`, #29): this is "what does the whole season
 * look like laid out", showing `PlantPeriod` sowing/harvest *windows* as
 * bars, not "what's due right now" or a navigable date grid. Desktop-only
 * (no mobile route) - a wide,
 * data-dense Gantt grid isn't a fit for the simplified mobile/PWA route
 * set the same way the canvas editor itself isn't. */
export function Timeline() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6">
      <h1 className="text-xl font-medium">Timeline</h1>
      <TimelineView />
    </div>
  );
}
