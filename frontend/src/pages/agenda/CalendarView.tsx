import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioToggleGroup } from "@/components/ui/toggle-group";
import {
  listActions,
  listBedEquipment,
  listBeds,
  listPlants,
  type Action,
  type Bed,
  type BedEquipment,
  type Plant,
} from "@/api/client";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { formatDueDateHeading, groupActionsByDueDate, taskDueDateKey, taskLabel } from "./taskAgenda";
import { ACTION_STATUS_DOT_CLASS, ACTION_STATUS_GLYPH, ACTION_STATUS_PILL_CLASS } from "./actionStatusStyles";
import { addDays, addMonths, addWeeks, isoYearMonth, isToday, monthGridDays, weekDays } from "./calendarGrid";
import { MiniCalendar } from "./MiniCalendar";
import { NewTaskDialog } from "./NewTaskDialog";
import { TaskAgendaView } from "./TaskAgendaView";

type CalendarMode = "month" | "week" | "day" | "list";

const MONTH_NAMES_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MAX_PILLS_PER_CELL = 3;

const EMPTY_ACTIONS: Action[] = [];

function shortDate(iso: string, withYear: boolean): string {
  const opts: Intl.DateTimeFormatOptions = withYear
    ? { month: "short", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric" };
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);
}

function periodLabel(mode: CalendarMode, focusDate: string, gridStart: string, gridEnd: string): string {
  if (mode === "month") {
    const { year, month } = isoYearMonth(focusDate);
    return `${MONTH_NAMES_FULL[month - 1]} ${year}`;
  }
  if (mode === "week") return `${shortDate(gridStart, false)} – ${shortDate(gridEnd, true)}`;
  return formatDueDateHeading(focusDate);
}

function stepDate(mode: CalendarMode, focusDate: string, direction: 1 | -1): string {
  if (mode === "month") return addMonths(focusDate, direction);
  if (mode === "week") return addWeeks(focusDate, direction);
  return addDays(focusDate, direction);
}

interface TaskContext {
  plantsBySlug: Map<string, Plant>;
  bedsById: Map<number, Bed>;
  equipmentById: Map<number, BedEquipment>;
}

/** A single day's drill-in trigger + its tasks, rendered as status-colored
 * pills (desktop, ≥640px) or status-colored dots (mobile, <640px) - Month
 * view's per-cell content (#29's design spec). Two parallel render trees
 * switched by a Tailwind breakpoint rather than JS viewport detection,
 * matching how `CalendarView` is one shared component (not two) per its own
 * doc below. */
function MonthCell({
  iso,
  inCurrentMonth,
  dayActions,
  ctx,
  onDrillIn,
}: {
  iso: string;
  inCurrentMonth: boolean;
  dayActions: Action[];
  ctx: TaskContext;
  onDrillIn: (iso: string) => void;
}) {
  const today = todayIsoDate();
  const isTodayCell = isToday(iso, today);
  const dayNumber = Number(iso.slice(8, 10));
  const shownDesktop = dayActions.slice(0, MAX_PILLS_PER_CELL);
  const extraDesktop = dayActions.length - shownDesktop.length;
  const ariaLabel = `${new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}, ${dayActions.length} task${dayActions.length === 1 ? "" : "s"}`;

  return (
    <div className={`flex min-h-20 flex-col gap-1 border-t border-l p-1 last:border-r ${inCurrentMonth ? "" : "bg-muted/20"}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onDrillIn(iso)}
        className={`self-start rounded-full px-1.5 text-xs font-medium ${
          isTodayCell ? "bg-primary text-primary-foreground" : inCurrentMonth ? "text-foreground" : "text-muted-foreground/50"
        }`}
      >
        {dayNumber}
      </button>

      {/* Desktop: up to 3 status-colored pills + "+N more". */}
      <div className="hidden flex-col gap-0.5 sm:flex">
        {shownDesktop.map((action) => (
          <Link
            key={action.id}
            to={`/tasks/${action.id}`}
            className={`truncate rounded px-1 py-0.5 text-[0.7rem] leading-tight ${ACTION_STATUS_PILL_CLASS[action.status]}`}
          >
            {ACTION_STATUS_GLYPH[action.status]}
            {taskLabel(action, ctx.plantsBySlug, ctx.bedsById, ctx.equipmentById)}
          </Link>
        ))}
        {extraDesktop > 0 && (
          <button
            type="button"
            onClick={() => onDrillIn(iso)}
            className="self-start text-[0.7rem] text-muted-foreground hover:underline"
          >
            +{extraDesktop} more
          </button>
        )}
      </div>

      {/* Mobile: status-colored dots only, no room for label text. */}
      <div className="flex flex-wrap gap-0.5 sm:hidden">
        {dayActions.map((action) => (
          <span key={action.id} className={`size-1.5 rounded-full ${ACTION_STATUS_DOT_CLASS[action.status]}`} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

/** One day's full task row, shared by Week (desktop) and Day view - status
 * marker + un-truncated label, distinct from Month's compact pill/dot. */
function TaskRow({ action, ctx }: { action: Action; ctx: TaskContext }) {
  return (
    <Link
      to={`/tasks/${action.id}`}
      className={`block rounded px-2 py-1 text-sm ${ACTION_STATUS_PILL_CLASS[action.status]}`}
    >
      {ACTION_STATUS_GLYPH[action.status]}
      {taskLabel(action, ctx.plantsBySlug, ctx.bedsById, ctx.equipmentById)}
    </Link>
  );
}

/** Calendar view of planting-derived actions (#29) - a real Month/Week/Day/
 * List calendar of `Action` rows (not `PlantPeriod` windows, which live on
 * the Timeline view, #182), per `ui-ux-designer`'s 2026-08-03 design pass.
 * One shared component for both `Agenda.tsx` (desktop) and
 * `MobileAgenda.tsx` (mobile) - Month/Week branch internally at Tailwind's
 * `sm` (640px) breakpoint (pills vs. dots, single-row grid vs. stacked day
 * sections); Day/List render identically on both. List mode renders the
 * pre-existing `TaskAgendaView` completely unchanged (pending-only,
 * day-grouped) - Month/Week/Day instead show every action regardless of
 * status (pending/completed/skipped), since a navigable calendar doubles as
 * a historical record, differentiated visually via `actionStatusStyles.ts`
 * (never color alone - completed also gets a check glyph, skipped also gets
 * `line-through`).
 *
 * Month/Week grids are plain semantic DOM (a content-browsing surface with
 * real controls in natural tab order, same call Timeline's own Gantt grid
 * already makes) - not `role="grid"`. The mini-calendar (`MiniCalendar.tsx`)
 * is the one place a real date-picker ARIA pattern applies. */
export function CalendarView() {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [focusDate, setFocusDate] = useState(todayIsoDate());
  const today = todayIsoDate();

  const gridDays = useMemo(() => {
    if (mode === "month") {
      const { year, month } = isoYearMonth(focusDate);
      return monthGridDays(year, month);
    }
    if (mode === "week") return weekDays(focusDate).map((iso) => ({ iso, inCurrentMonth: true }));
    return [{ iso: focusDate, inCurrentMonth: true }];
  }, [mode, focusDate]);
  const gridStart = gridDays[0].iso;
  const gridEnd = gridDays[gridDays.length - 1].iso;

  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds, enabled: mode !== "list" });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500), enabled: mode !== "list" });
  const equipmentQuery = useQuery({ queryKey: ["bed-equipment"], queryFn: listBedEquipment, enabled: mode !== "list" });
  // Widened to `dueTo` only (no `dueFrom`) - the backend's own range filter
  // is `due_date_start >= due_from AND due_date_end <= due_to` (see
  // `api/client.ts`'s `listActions` doc), which would wrongly exclude a
  // multi-week action window that started before the visible grid but ends
  // within it if `due_from` were pinned to the grid's own start. The exact
  // visible-range cut is applied client-side below instead, keyed off
  // `due_date_end` (the same "day-cell date" `taskDueDateKey` already
  // defines for List mode).
  const actionsQuery = useQuery({
    queryKey: ["actions", "calendar", mode, focusDate],
    queryFn: () => listActions({ dueTo: gridEnd }),
    enabled: mode !== "list",
  });

  const byDate = useMemo(() => {
    const inRange = (actionsQuery.data ?? EMPTY_ACTIONS).filter((a) => {
      const key = taskDueDateKey(a);
      return key != null && key >= gridStart && key <= gridEnd;
    });
    return groupActionsByDueDate(inRange);
  }, [actionsQuery.data, gridStart, gridEnd]);

  const ctx: TaskContext = useMemo(
    () => ({
      plantsBySlug: new Map((plantsQuery.data ?? []).map((p) => [p.slug, p])),
      bedsById: new Map((bedsQuery.data ?? []).filter((b) => b.id != null).map((b) => [b.id as number, b])),
      equipmentById: new Map((equipmentQuery.data ?? []).filter((e) => e.id != null).map((e) => [e.id as number, e])),
    }),
    [plantsQuery.data, bedsQuery.data, equipmentQuery.data],
  );

  const isPending = mode !== "list" && (bedsQuery.isPending || plantsQuery.isPending || equipmentQuery.isPending || actionsQuery.isPending);
  const isError = mode !== "list" && (bedsQuery.isError || plantsQuery.isError || equipmentQuery.isError || actionsQuery.isError);

  function drillIntoDay(iso: string) {
    setFocusDate(iso);
    setMode("day");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setFocusDate(today)}>
          Today
        </Button>

        {/* #227: reachable regardless of which mode (Month/Week/Day/List) is
            active, and - since this is the one CalendarView both Agenda.tsx
            (desktop) and MobileAgenda.tsx (mobile) render unmodified - on
            both platforms from this single insertion point. */}
        <NewTaskDialog />

        {mode !== "list" && (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Previous"
              onClick={() => setFocusDate(stepDate(mode, focusDate, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <MiniCalendar
              focusDate={focusDate}
              triggerLabel={periodLabel(mode, focusDate, gridStart, gridEnd)}
              onSelect={setFocusDate}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Next"
              onClick={() => setFocusDate(stepDate(mode, focusDate, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </>
        )}

        <div className="ml-auto">
          <RadioToggleGroup<CalendarMode>
            ariaLabel="Calendar view"
            value={mode}
            onChange={setMode}
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
              { value: "day", label: "Day" },
              { value: "list", label: "List" },
            ]}
          />
        </div>
      </div>

      {mode === "list" && <TaskAgendaView />}

      {mode !== "list" && isPending && <p className="text-sm text-muted-foreground">Loading calendar…</p>}
      {mode !== "list" && isError && <p className="text-sm text-destructive">Failed to load the calendar.</p>}

      {mode === "month" && !isPending && !isError && (
        <div className="grid grid-cols-7 overflow-hidden rounded-md border-r border-b">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div key={label} className="border-t border-l bg-muted/50 px-1 py-1 text-center text-xs font-medium text-muted-foreground">
              {label}
            </div>
          ))}
          {gridDays.map((day) => (
            <MonthCell
              key={day.iso}
              iso={day.iso}
              inCurrentMonth={day.inCurrentMonth}
              dayActions={byDate.get(day.iso) ?? []}
              ctx={ctx}
              onDrillIn={drillIntoDay}
            />
          ))}
        </div>
      )}

      {mode === "week" && !isPending && !isError && (
        <>
          {/* Desktop: 7-column single-row grid, taller cells, full-width
              task rows. */}
          <div className="hidden grid-cols-7 gap-2 sm:grid">
            {gridDays.map((day) => (
              <div key={day.iso} className="flex flex-col gap-1 rounded-md border p-2">
                <span
                  className={`self-start rounded-full px-1.5 text-xs font-medium ${isToday(day.iso, today) ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                >
                  {new Date(`${day.iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </span>
                <div className="flex flex-col gap-1">
                  {(byDate.get(day.iso) ?? []).map((action) => (
                    <TaskRow key={action.id} action={action} ctx={ctx} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Mobile: a 50px column can't hold a real row - stack 7 day
              sections instead; empty days render header-only, no filler
              line. */}
          <div className="flex flex-col gap-2 sm:hidden">
            {gridDays.map((day) => {
              const dayActions = byDate.get(day.iso) ?? [];
              return (
                <div key={day.iso} className="flex flex-col gap-1">
                  <span className={`text-sm font-medium ${isToday(day.iso, today) ? "text-primary" : "text-foreground"}`}>
                    {new Date(`${day.iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric" })}
                  </span>
                  {dayActions.length > 0 && (
                    <div className="flex flex-col gap-1 pl-1">
                      {dayActions.map((action) => (
                        <TaskRow key={action.id} action={action} ctx={ctx} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {mode === "day" && !isPending && !isError && (
        <div className="flex flex-col gap-1">
          {(byDate.get(focusDate) ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks due on {formatDueDateHeading(focusDate)}.</p>
          ) : (
            (byDate.get(focusDate) ?? []).map((action) => <TaskRow key={action.id} action={action} ctx={ctx} />)
          )}
        </div>
      )}
    </div>
  );
}
