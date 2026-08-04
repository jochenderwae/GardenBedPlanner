import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getPlant,
  listActions,
  listBeds,
  listPeriodTypes,
  listPlantings,
  type Action,
  type Bed,
  type Plant,
  type Planting,
} from "@/api/client";
import { Select } from "@/components/ui/input";
import { RadioToggleGroup } from "@/components/ui/toggle-group";
import { Tooltip } from "@/components/ui/tooltip";
import { ACTION_TYPE_LABELS } from "@/pages/agenda/taskAgenda";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { ACTION_STATUS_DIAMOND_CLASS, periodTypeChartClass } from "./timelineColors";
import {
  actionDueDate,
  actionsForBedOnly,
  actionsForRow,
  bedIdsWithBedOnlyActions,
  dayFractionInMonth,
  dayFractionInWeek,
  periodBarSegments,
  periodsForPlant,
  timelineRows,
  timelineYears,
  weekOfYear,
  weekRangeForMonths,
  type TimelineRow,
} from "./timelineData";
import { TimelineDetailPanel, type TimelineSelection } from "./TimelineDetailPanel";

type Granularity = "month" | "week";

const LABEL_COL_PX = 176;
const MONTH_COL_MIN_PX = 64;
const WEEK_COL_MIN_PX = 28;
/** Every row's own fixed height regardless of how many distinct period
 * types it stacks as sub-lanes - a Gantt row that grows per-row would make
 * the grid's own column alignment (computed once, reused by the header and
 * every row - see `gridTemplateColumns` below) harder to reason about for
 * comparatively little benefit at this app's scale (a handful of period
 * types per plant, never dozens). */
const ROW_HEIGHT_PX = 40;
const MAX_LANES = 4;

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

// Stable references for a not-yet-loaded query's fallback - `?? []` alone
// would produce a brand-new array every render, defeating every `useMemo`
// below that depends on it (oxlint's own exhaustive-deps warning is correct
// that a fresh literal changes "every render" even though the *contents*
// obviously haven't).
const EMPTY_PLANTINGS: Planting[] = [];
const EMPTY_BEDS: Bed[] = [];
const EMPTY_ACTIONS: Action[] = [];

function gridTemplateColumns(numCols: number, colMinPx: number): string {
  return `${LABEL_COL_PX}px repeat(${numCols}, minmax(${colMinPx}px, 1fr))`;
}

/** A single `PlantPeriod` bar segment, positioned via `grid-column`
 * placement at either Month or Week granularity - see `TimelineView`'s own
 * doc for why every mark on this grid (bars and diamonds alike) is placed
 * this way rather than a from-scratch pixel-offset layout. */
function PeriodBar({
  startCol,
  endCol,
  laneIndex,
  laneCount,
  colorClass,
  label,
  onClick,
}: {
  startCol: number;
  endCol: number;
  laneIndex: number;
  laneCount: number;
  colorClass: string;
  label: string;
  onClick: () => void;
}) {
  const laneHeight = ROW_HEIGHT_PX / Math.max(1, laneCount);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      title={label}
      className={`absolute rounded-full ${colorClass} opacity-80 hover:opacity-100`}
      style={{
        gridColumn: `${startCol + 1} / ${endCol + 2}`,
        gridRow: 1,
        top: laneIndex * laneHeight + 2,
        height: Math.max(4, laneHeight - 4),
        left: 0,
        right: 0,
      }}
    />
  );
}

/** One task's due-date marker, positioned at `leftPercent` within its own
 * single grid column cell (day-of-month/day-of-week precision within that
 * column - see `dayFractionInMonth`/`dayFractionInWeek`) and vertically
 * centered across the whole row regardless of how many period-bar lanes
 * are stacked beneath it, per the design spec's "diamonds layered above
 * the bars, not merged into them." `jitterPx` nudges same-day diamonds
 * apart horizontally so a second task due the same day doesn't render
 * exactly on top of the first. */
function TaskDiamond({
  leftPercent,
  jitterPx,
  statusClass,
  tooltip,
  onClick,
}: {
  leftPercent: number;
  jitterPx: number;
  statusClass: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        aria-label={tooltip}
        onClick={onClick}
        className={`absolute top-1/2 size-2.5 -translate-y-1/2 rotate-45 ${statusClass}`}
        style={{ left: `calc(${leftPercent}% + ${jitterPx}px)` }}
      />
    </Tooltip>
  );
}

/** Every task belonging to one row/column-cell wrapper - a thin, full-row-
 * height `position: relative` cell occupying exactly one grid column, so
 * `TaskDiamond`'s own `left: X%` is relative to that single month/week's
 * width, not the whole grid's. */
function DiamondColumn({ col, diamonds }: { col: number; diamonds: { key: string; leftPercent: number; statusClass: string; tooltip: string; onClick: () => void }[] }) {
  if (diamonds.length === 0) return null;
  return (
    <div className="relative" style={{ gridColumn: col + 1, gridRow: 1 }}>
      {diamonds.map((d, i) => (
        <TaskDiamond key={d.key} leftPercent={d.leftPercent} jitterPx={i * 4} statusClass={d.statusClass} tooltip={d.tooltip} onClick={d.onClick} />
      ))}
    </div>
  );
}

interface DiamondPlacement {
  key: string;
  col: number;
  leftPercent: number;
  statusClass: string;
  tooltip: string;
  onClick: () => void;
}

function groupDiamondsByColumn(diamonds: DiamondPlacement[]): Map<number, DiamondPlacement[]> {
  const byCol = new Map<number, DiamondPlacement[]>();
  for (const d of diamonds) {
    const list = byCol.get(d.col) ?? [];
    list.push(d);
    byCol.set(d.col, list);
  }
  return byCol;
}

/** A season/year overview: months (or weeks) across the top, one row per
 * crop planting active in the selected year showing its plant-period
 * windows as bars and generated tasks as diamond markers, plus per-bed
 * swimlanes below for bed-level tasks that aren't tied to one specific crop
 * (#182). Implements the `ui-ux-designer` design spec posted on the ticket:
 * hand-rolled DOM/CSS-grid (not `react-konva`, not a Gantt library - this
 * is a scrolling table with text/hover/click targets, not spatial WYSIWYG
 * editing), a Month/Week granularity toggle, and a side detail panel
 * reusing the same slot `BedPanel`/`PlantingPanel` use in `Layout.tsx`.
 *
 * Every mark (period bar, task diamond) is positioned via CSS Grid
 * `gridColumn` placement rather than a from-scratch pixel layout - the
 * header row and every data row below it share one `gridTemplateColumns`
 * definition (computed once per render from the current granularity), so a
 * bar's `gridColumn: N` always lines up under the Nth month/week header
 * even though each row is its own separate grid container (not one giant
 * grid spanning the whole table) - the same "consistent column template
 * across sibling grids" technique any CSS-Gantt layout relies on instead of
 * a `<table>`, which can't do `grid-column: start / span N` bar placement.
 * Within one grid cell, day-precision (a diamond's exact due date, not just
 * which month/week it falls in) comes from a nested `position: relative`
 * wrapper + `left: X%` - see `DiamondColumn`/`TaskDiamond`. */
export function TimelineView() {
  const today = todayIsoDate();
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings });
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const periodTypesQuery = useQuery({ queryKey: ["period-types"], queryFn: listPeriodTypes });

  const plantings = plantingsQuery.data ?? EMPTY_PLANTINGS;
  const beds = bedsQuery.data ?? EMPTY_BEDS;
  const bedsById = useMemo(() => new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b])), [beds]);

  const years = useMemo(() => timelineYears(plantings, today), [plantings, today]);
  const [selectedYear, setSelectedYear] = useState<number>(years[years.length - 1] ?? Number(today.slice(0, 4)));
  // The year selector's own option list can grow once new plantings/removals
  // land in a not-yet-seen year - if the currently-selected year fell out of
  // that list (e.g. it was the only planting in a year that just got
  // deleted), fall back to the latest one rather than rendering a selected
  // `<option>` that no longer exists.
  const effectiveYear = years.includes(selectedYear) ? selectedYear : (years[years.length - 1] ?? selectedYear);

  const [granularity, setGranularity] = useState<Granularity>("month");
  const [selection, setSelection] = useState<TimelineSelection | null>(null);

  const distinctSlugs = useMemo(() => [...new Set(plantings.map((p) => p.plant_slug))], [plantings]);
  // Same per-distinct-plant PlantDetail fetch pattern the old AgendaView.tsx
  // (removed by #29) used - periods only come back on the single-plant GET,
  // never the list one (see api/client.ts's PlantDetail doc).
  const plantQueries = useQueries({
    queries: distinctSlugs.map((slug) => ({ queryKey: ["plant", slug], queryFn: () => getPlant(slug) })),
  });
  const plantsBySlug = useMemo(() => {
    const map = new Map<string, Plant>();
    for (const q of plantQueries) {
      if (q.data) map.set(q.data.slug, q.data);
    }
    return map;
  }, [plantQueries]);
  const periodsBySlug = useMemo(() => {
    const map = new Map<string, ReturnType<typeof periodsForPlant>>();
    for (const q of plantQueries) {
      if (q.data) map.set(q.data.slug, periodsForPlant(q.data.periods, q.data.slug));
    }
    return map;
  }, [plantQueries]);

  const actionsQuery = useQuery({
    queryKey: ["actions", "timeline", effectiveYear],
    queryFn: () => listActions({ dueFrom: `${effectiveYear}-01-01`, dueTo: `${effectiveYear}-12-31` }),
  });
  const actions = actionsQuery.data ?? EMPTY_ACTIONS;

  const periodTypeLabelsByCode = useMemo(
    () => new Map((periodTypesQuery.data ?? []).map((pt) => [pt.code, pt.description || pt.code])),
    [periodTypesQuery.data],
  );

  const rows = useMemo(
    () => timelineRows(plantings, effectiveYear, plantsBySlug, bedsById),
    [plantings, effectiveYear, plantsBySlug, bedsById],
  );
  const swimlaneBeds = useMemo(() => {
    const ids = bedIdsWithBedOnlyActions(actions);
    return beds.filter((b) => b.id != null && ids.has(b.id));
  }, [actions, beds]);

  const isPending = plantingsQuery.isPending || bedsQuery.isPending || periodTypesQuery.isPending || actionsQuery.isPending;
  const isError = plantingsQuery.isError || bedsQuery.isError || periodTypesQuery.isError || actionsQuery.isError;

  const numCols = granularity === "month" ? 12 : weekOfYear(`${effectiveYear}-12-31`);
  const colMinPx = granularity === "month" ? MONTH_COL_MIN_PX : WEEK_COL_MIN_PX;
  const columns = gridTemplateColumns(numCols, colMinPx);
  const columnLabels: string[] = useMemo(
    () => (granularity === "month" ? [...MONTH_NAMES_SHORT] : Array.from({ length: numCols }, (_, i) => `W${i + 1}`)),
    [granularity, numCols],
  );

  /** A period bar segment's start/end grid column (1-indexed, matching
   * `columnLabels`) at the currently-selected granularity. */
  function barColumns(startMonth: number, endMonth: number): { startCol: number; endCol: number } {
    if (granularity === "month") return { startCol: startMonth, endCol: endMonth };
    const { startWeek, endWeek } = weekRangeForMonths(effectiveYear, startMonth, endMonth);
    return { startCol: startWeek, endCol: endWeek };
  }

  /** A due date's own grid column + within-column fraction at the
   * currently-selected granularity. */
  function diamondPosition(dueDate: string): { col: number; leftPercent: number } {
    if (granularity === "month") {
      return { col: Number(dueDate.slice(5, 7)), leftPercent: dayFractionInMonth(dueDate) * 100 };
    }
    return { col: weekOfYear(dueDate), leftPercent: dayFractionInWeek(dueDate) * 100 };
  }

  function taskTooltip(action: Action): string {
    const dueDate = actionDueDate(action);
    const label = ACTION_TYPE_LABELS[action.action_type] ?? action.action_type;
    return dueDate ? `${label} — ${dueDate}` : label;
  }

  function diamondsForActions(actionList: Action[], contextLabel: string): DiamondPlacement[] {
    const placements: DiamondPlacement[] = [];
    for (const action of actionList) {
      const dueDate = actionDueDate(action);
      if (!dueDate || dueDate.slice(0, 4) !== String(effectiveYear)) continue;
      const { col, leftPercent } = diamondPosition(dueDate);
      placements.push({
        key: `action-${action.id}`,
        col,
        leftPercent,
        statusClass: ACTION_STATUS_DIAMOND_CLASS[action.status],
        tooltip: taskTooltip(action),
        onClick: () => setSelection({ type: "task", action, contextLabel }),
      });
    }
    return placements;
  }

  function renderCropRow(row: TimelineRow) {
    const periods = periodsBySlug.get(row.plant.slug) ?? [];
    const laneTypes = [...new Set(periods.map((p) => p.period_type))].slice(0, MAX_LANES);
    const bars = periods.flatMap((period) => {
      const laneIndex = laneTypes.indexOf(period.period_type);
      if (laneIndex === -1) return [];
      return periodBarSegments(period.start_month, period.end_month).map((seg, i) => {
        const { startCol, endCol } = barColumns(seg.startMonth, seg.endMonth);
        const label = `${periodTypeLabelsByCode.get(period.period_type) ?? period.period_type} — ${row.plant.common_name}`;
        return (
          <PeriodBar
            key={`${period.id}-${i}`}
            startCol={startCol}
            endCol={endCol}
            laneIndex={laneIndex}
            laneCount={laneTypes.length}
            colorClass={periodTypeChartClass(period.period_type)}
            label={label}
            onClick={() =>
              setSelection({
                type: "period",
                row,
                period,
                periodTypeLabel: periodTypeLabelsByCode.get(period.period_type) ?? period.period_type,
              })
            }
          />
        );
      });
    });

    const bedId = row.bed.id;
    const diamonds =
      bedId != null
        ? diamondsForActions(actionsForRow(actions, bedId, row.plant.slug), `${row.plant.common_name} in ${row.bed.name}`)
        : [];
    const byCol = groupDiamondsByColumn(diamonds);

    // #233: a row now groups every Planting sharing this (bed, plant) pair,
    // not just one - the common single-planting case reads identically to
    // before (plain plant name + bed name subtitle), a grouped row adds a
    // "N plantings" count to both the subtitle and the accessible name so
    // it's clear at a glance (and to a screen reader) that the row
    // represents more than one physical plant.
    const plantingCount = row.plantings.length;
    const accessibleName =
      plantingCount > 1
        ? `${row.plant.common_name} — ${row.bed.name} (${plantingCount} plantings)`
        : row.plant.common_name;

    return (
      <div key={`${bedId}-${row.plant.slug}`} className="relative grid" style={{ gridTemplateColumns: columns, height: ROW_HEIGHT_PX }}>
        <button
          type="button"
          className="sticky left-0 z-10 truncate bg-background pr-2 text-left text-sm font-medium hover:underline"
          style={{ gridColumn: 1 }}
          onClick={() => setSelection({ type: "planting", row })}
          title={accessibleName}
        >
          {row.plant.common_name}
          <span className="block text-xs font-normal text-muted-foreground">
            {plantingCount > 1 ? `${row.bed.name} · ${plantingCount} plantings` : row.bed.name}
          </span>
        </button>
        {bars}
        {[...byCol.entries()].map(([col, ds]) => (
          <DiamondColumn key={col} col={col} diamonds={ds} />
        ))}
      </div>
    );
  }

  function renderBedSwimlane(bed: Bed) {
    if (bed.id == null) return null;
    const diamonds = diamondsForActions(actionsForBedOnly(actions, bed.id), bed.name);
    const byCol = groupDiamondsByColumn(diamonds);
    return (
      <div key={`bed-${bed.id}`} className="relative grid" style={{ gridTemplateColumns: columns, height: ROW_HEIGHT_PX }}>
        <button
          type="button"
          className="sticky left-0 z-10 truncate bg-background pr-2 text-left text-sm font-medium hover:underline"
          style={{ gridColumn: 1 }}
          onClick={() => setSelection({ type: "bed", bed })}
          title={bed.name}
        >
          {bed.name}
          <span className="block text-xs font-normal text-muted-foreground">Bed tasks</span>
        </button>
        {[...byCol.entries()].map(([col, ds]) => (
          <DiamondColumn key={col} col={col} diamonds={ds} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Year
          <Select value={String(effectiveYear)} onChange={(e) => setSelectedYear(Number(e.target.value))} className="w-auto">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </label>
        <RadioToggleGroup<Granularity>
          ariaLabel="Granularity"
          value={granularity}
          onChange={setGranularity}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
          ]}
        />
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading timeline…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load the timeline.</p>}

      {!isPending && !isError && rows.length === 0 && swimlaneBeds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing to show for {effectiveYear} yet - plantings and their generated tasks will show up here once you have
          some.
        </p>
      )}

      {!isPending && !isError && (rows.length > 0 || swimlaneBeds.length > 0) && (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="min-w-0 flex-1 overflow-auto rounded-md border">
            <div className="min-w-fit">
              {/* Sticky header row - month/week labels, frozen at the top of
                  this scroll container the same way the label column below
                  is frozen at the left, per the design spec's density fix. */}
              <div
                className="sticky top-0 z-20 grid border-b bg-muted/50 text-xs font-medium text-muted-foreground"
                style={{ gridTemplateColumns: columns, height: 28 }}
              >
                <div className="sticky left-0 z-30 bg-muted/50" style={{ gridColumn: 1 }} />
                {columnLabels.map((label, i) => (
                  <div key={label} className="flex items-center justify-center" style={{ gridColumn: i + 2 }}>
                    {label}
                  </div>
                ))}
              </div>

              {rows.length > 0 && <div className="flex flex-col">{rows.map(renderCropRow)}</div>}

              {swimlaneBeds.length > 0 && (
                <div className="flex flex-col border-t">
                  <div className="sticky left-0 z-10 bg-muted/30 px-2 py-1 text-xs font-medium text-muted-foreground">
                    Bed tasks
                  </div>
                  {swimlaneBeds.map(renderBedSwimlane)}
                </div>
              )}
            </div>
          </div>

          {selection && (
            <div className="h-full w-80 shrink-0 overflow-y-auto">
              <TimelineDetailPanel selection={selection} onClose={() => setSelection(null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
