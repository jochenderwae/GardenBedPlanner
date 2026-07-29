import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Layer, Stage } from "react-konva";
import { Card } from "@/components/ui/card";
import { KNOWN_HABITS, PlantFootprint } from "./PlantFootprint";

/** User-facing label for each `PlantFootprint` shape, in the same order as
 * `KNOWN_HABITS` (plus the fallback circle last) - see #172's design spec.
 * "Unspecified" rather than "Fallback"/"Other" since it's explaining "this
 * plant has no growth-habit data on file" to the user, not an internal
 * implementation term. */
const HABIT_LABELS: Record<(typeof KNOWN_HABITS)[number], string> = {
  upright: "Upright",
  spreading: "Spreading",
  climbing: "Climbing",
  rosette: "Rosette",
  tree: "Tree",
};

// Generic swatch styling - the legend explains the *shape* vocabulary, not
// any one plant's own color, so it deliberately doesn't call `colorForSlug`
// the way real markers do.
const SWATCH_SIZE_PX = 18;
const SWATCH_FILL = "#6b7280";
const SWATCH_STROKE = "#374151";

/** Tiny literal render of the real `PlantFootprint` shape, not a hand-drawn
 * SVG approximation - what makes #172's "How to test" #3 (legend shapes
 * visually match what `PlantFootprint.tsx` actually renders) true by
 * construction rather than something that can silently drift if either file
 * changes independently later. */
function ShapeSwatch({ growthHabit }: { growthHabit: string | null }) {
  return (
    <Stage width={SWATCH_SIZE_PX} height={SWATCH_SIZE_PX}>
      <Layer>
        <PlantFootprint
          growthHabit={growthHabit}
          x={SWATCH_SIZE_PX / 2}
          y={SWATCH_SIZE_PX / 2}
          radius={7}
          fill={SWATCH_FILL}
          opacity={1}
          stroke={SWATCH_STROKE}
          strokeWidth={1}
          listening={false}
        />
      </Layer>
    </Stage>
  );
}

/** Persistent, collapsible key explaining what each of `PlantFootprint`'s
 * distinct growth-habit shapes means (#172) - a bottom-left corner overlay
 * (the one corner with no existing chrome competing for space: `RulerLayer`
 * owns the top edges, `Toolbar` owns two rows above the canvas) rendered
 * whenever plant shapes can actually appear on screen, not hidden behind a
 * toggle the user has to already know to look for. See #172's own design
 * spec (that issue's comment thread) for the full rationale.
 *
 * Self-contained (owns its own expanded/collapsed state) - drop
 * `<GrowthHabitLegend />` into any canvas container the same way
 * `<PlantingTooltip tooltip={tooltip} />` already is. */
export function GrowthHabitLegend() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="absolute bottom-2 left-2 z-10 w-36">
      <Card size="sm" className="bg-card/95 shadow-md backdrop-blur-sm">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="growth-habit-legend-list"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-3 text-xs font-medium text-muted-foreground"
        >
          <span>Plant shapes</span>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {expanded && (
          <ul id="growth-habit-legend-list" className="flex flex-col gap-1.5 px-3 pb-3 pt-1.5">
            {KNOWN_HABITS.map((habit) => (
              <li key={habit} className="flex items-center gap-2">
                <ShapeSwatch growthHabit={habit} />
                <span className="text-xs text-foreground">{HABIT_LABELS[habit]}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <ShapeSwatch growthHabit={null} />
              <span className="text-xs text-foreground">Unspecified</span>
            </li>
          </ul>
        )}
      </Card>
    </div>
  );
}
