import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDaysToIsoDate, daysBetweenIsoDates, todayIsoDate } from "./plantingLifecycle";

interface DateScrubberProps {
  value: string;
  onChange: (value: string) => void;
  /** The scrubbable window's own inclusive endpoints (ISO date) - derived by
   * the caller (`Layout.tsx`'s `defaultScrubberRange`) from the garden's
   * actual planting history plus a fixed buffer, not a fixed calendar year -
   * a garden whose plantings span several years should still be scrubbable
   * end to end. */
  minDate: string;
  maxDate: string;
}

/** A drag-to-scrub date control for the View tab's now-real-data timeline
 * (#180) - a plain HTML range input (no dedicated Slider primitive exists
 * yet in this design system) mapped over whole days between `minDate`/
 * `maxDate`, paired with an `<input type="date">` for exact-day entry so the
 * day-level granularity the rest of the app already works in
 * (`PlantingPanel`'s own `removed_date` field) stays available here too,
 * not just drag-approximate. */
export function DateScrubber({ value, onChange, minDate, maxDate }: DateScrubberProps) {
  const totalDays = Math.max(1, daysBetweenIsoDates(minDate, maxDate));
  const offset = Math.min(Math.max(daysBetweenIsoDates(minDate, value), 0), totalDays);
  const isToday = value === todayIsoDate();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">As of</span>
      <input
        type="range"
        min={0}
        max={totalDays}
        value={offset}
        onChange={(e) => onChange(addDaysToIsoDate(minDate, Number(e.target.value)))}
        className="w-40 accent-primary"
        aria-label="Date to view the garden as of"
      />
      <Input
        type="date"
        min={minDate}
        max={maxDate}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="w-36"
        aria-label="As-of date"
      />
      {!isToday && (
        <Button size="sm" variant="ghost" onClick={() => onChange(todayIsoDate())}>
          Today
        </Button>
      )}
    </div>
  );
}
