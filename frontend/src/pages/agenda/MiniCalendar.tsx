import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { listActions } from "@/api/client";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { addMonths, isoYearMonth, isToday, monthGridDays } from "./calendarGrid";
import { taskDueDateKey } from "./taskAgenda";

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

interface MiniCalendarProps {
  /** The calendar's own committed date (`CalendarView`'s `focusDate`) - the
   * month this popover opens browsing, reset every time it's (re)opened so
   * it never gets stuck on wherever a previous browse session left off. */
  focusDate: string;
  /** The toolbar's period label text, doubling as this popover's trigger
   * per the design spec. */
  triggerLabel: string;
  onSelect: (iso: string) => void;
}

/** Compact month-picker popover anchored to `CalendarView`'s toolbar period
 * label (#29's design spec) - its own independent `< Month Year >` browse
 * header (doesn't affect the main grid until a day is actually clicked),
 * presence-only dots for days with 1+ action, and 2-axis roving-tabindex
 * keyboard navigation (Left/Right = day, Up/Down = week) per the standard
 * WAI-ARIA date-grid pattern - the one place in this feature a real
 * date-picker ARIA role applies (Month/Week/Day's own grids stay plain
 * semantic DOM, see `CalendarView`'s doc). */
export function MiniCalendar({ focusDate, triggerLabel, onSelect }: MiniCalendarProps) {
  const [open, setOpen] = useState(false);
  const [browseIso, setBrowseIso] = useState(focusDate);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const today = todayIsoDate();

  // Reset the browsed month back to wherever the main view currently is
  // every time the popover (re)opens, rather than remembering a stale
  // browse position from last time.
  useEffect(() => {
    if (open) setBrowseIso(focusDate);
  }, [open, focusDate]);

  const { year, month } = isoYearMonth(browseIso);
  const days = useMemo(() => monthGridDays(year, month), [year, month]);

  useEffect(() => {
    const idx = days.findIndex((d) => d.iso === focusDate);
    setActiveIndex(idx === -1 ? days.findIndex((d) => d.inCurrentMonth) : idx);
  }, [days, focusDate]);

  const rangeStart = days[0]?.iso;
  const rangeEnd = days[days.length - 1]?.iso;
  const actionsQuery = useQuery({
    queryKey: ["actions", "calendar-mini", year, month],
    queryFn: () => listActions({ dueTo: rangeEnd }),
    enabled: open,
  });
  const datesWithActions = useMemo(() => {
    const set = new Set<string>();
    for (const action of actionsQuery.data ?? []) {
      const key = taskDueDateKey(action);
      if (key && rangeStart && key >= rangeStart && key <= (rangeEnd ?? key)) set.add(key);
    }
    return set;
  }, [actionsQuery.data, rangeStart, rangeEnd]);

  function commit(iso: string) {
    onSelect(iso);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const delta = deltas[e.key];
    if (delta === undefined) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        commit(days[index].iso);
      }
      return;
    }
    e.preventDefault();
    const nextIndex = Math.min(Math.max(index + delta, 0), days.length - 1);
    setActiveIndex(nextIndex);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="rounded px-2 py-1 text-sm font-medium hover:bg-muted">{triggerLabel}</PopoverTrigger>
      <PopoverPopup className="w-64">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => setBrowseIso(addMonths(browseIso, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium">
            {new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => setBrowseIso(addMonths(browseIso, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div role="grid" aria-label="Choose date" className="grid grid-cols-7 gap-0.5">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center text-[0.65rem] font-medium text-muted-foreground" aria-hidden="true">
              {label}
            </div>
          ))}
          {days.map((day, index) => {
            const isTodayCell = isToday(day.iso, today);
            const hasActions = datesWithActions.has(day.iso);
            const dayNumber = Number(day.iso.slice(8, 10));
            return (
              <button
                key={day.iso}
                ref={(el) => {
                  buttonRefs.current[index] = el;
                }}
                type="button"
                role="gridcell"
                tabIndex={index === activeIndex ? 0 : -1}
                aria-current={isTodayCell ? "date" : undefined}
                aria-label={new Date(`${day.iso}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                onClick={() => commit(day.iso)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                className={`relative flex size-8 flex-col items-center justify-center rounded text-xs hover:bg-muted ${
                  day.inCurrentMonth ? "text-foreground" : "text-muted-foreground/40"
                } ${isTodayCell ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
              >
                {dayNumber}
                {hasActions && (
                  <span
                    className={`absolute bottom-0.5 size-1 rounded-full ${isTodayCell ? "bg-primary-foreground" : "bg-primary"}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
