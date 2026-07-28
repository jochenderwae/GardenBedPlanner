import type { ReactNode } from "react";
import { Maximize, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioToggleGroup, TabToggleGroup } from "@/components/ui/toggle-group";
import { Tooltip } from "@/components/ui/tooltip";
import type { Plant } from "@/api/client";
import { DateScrubber } from "./DateScrubber";
import type { PlacementMode } from "./PlantPlacementLayer";

export type ViewMode = "mine" | "example";

/** Order here doubles as the intended workflow progression (shape the
 * garden, then place beds within it, then plants, then equipment last) and
 * the tab-implied-locking sequence: each tab makes only its own object type
 * interactive (`GardenBoundary`/`BedNode`/`PlantPlacementLayer`/
 * `EquipmentLayer` each gate on exactly one tab), which - since only one
 * tab can be active at a time - automatically locks every *other* step,
 * not just the immediately-preceding one. The user can always switch back
 * to an earlier tab to edit it again; nothing here prevents that. */
export type PlacementTab = "garden" | "planters" | "plants" | "equipment";

const TAB_LABELS: Record<PlacementTab, string> = {
  garden: "Garden",
  planters: "Beds",
  plants: "Plants",
  equipment: "Equipment",
};
const TAB_OPTIONS = (Object.keys(TAB_LABELS) as PlacementTab[]).map((value) => ({ value, label: TAB_LABELS[value] }));

const PLACEMENT_MODE_LABELS: Record<PlacementMode, string> = {
  individual: "Point",
  row: "Row",
  field: "Area",
};
const PLACEMENT_MODE_OPTIONS = (Object.keys(PLACEMENT_MODE_LABELS) as PlacementMode[]).map((value) => ({
  value,
  label: PLACEMENT_MODE_LABELS[value],
}));

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "mine", label: "Edit" },
  { value: "example", label: "View" },
];

interface ToolbarProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  tab: PlacementTab;
  onTabChange: (tab: PlacementTab) => void;
  zoomPercent: number;
  onFitView: () => void;
  /** The "Add bed" trigger button + its dialog, as one self-contained
   * element (`AddBedForm`, built and passed in by `Layout.tsx`) - not a
   * plain callback the way this used to work, so the actual clickable
   * button can be a real `Dialog.Trigger` (see `dialog.tsx`'s own doc on
   * why that's load-bearing for focus-return-on-close, not just a styling
   * choice - #144's own follow-up bug report). */
  addBedForm: ReactNode;
  armedPlant: Plant | null;
  onClearArmedPlant: () => void;
  /** The "Pick a plant" trigger button + its popover, as one self-contained
   * element (`PlantPicker`, built and passed in by `Layout.tsx`) - same
   * rationale as `addBedForm` above, just for `Popover.Trigger` instead of
   * `Dialog.Trigger`. */
  plantPicker: ReactNode;
  placementMode: PlacementMode;
  onPlacementModeChange: (mode: PlacementMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** View tab's date scrubber (#180) - only rendered while
   * `mode === "example"`; see Layout.tsx's `defaultScrubberRange`. */
  viewAsOfDate: string;
  onViewAsOfDateChange: (date: string) => void;
  viewDateRange: { min: string; max: string };
}

/** The canvas editor's top-of-canvas control area, split into two always-
 * present rows so navigation never reflows when a mode's tool set changes
 * size (see the backlog item this was built for - a single flex row used to
 * wrap the tab switcher onto a second line once the Plants tab's tools grew
 * wide enough).
 *
 * Row 1 - navigation, always the same width regardless of mode/tab: view
 * mode (Edit your own beds today / View a read-only, date-scrubbable
 * snapshot of your real garden - see #180), the Garden/Beds/Plants/
 * Equipment tab switcher, zoom readout + "Fit view".
 *
 * Row 2 - whichever tools are specific to the active mode/tab (Add bed on
 * the Beds tab; pick-a-plant + Point/Row/Area mode on the Plants tab; the
 * date scrubber on the View tab). Always rendered (with a fixed min-height
 * even when it has no tools for the current tab) so switching tabs never
 * causes row 1 to jump up/down.
 *
 * Consolidated out of what used to be ad hoc JSX directly in Layout.tsx
 * specifically so future tool-mode controls (pan/select, once those land)
 * have one obvious home to slot into instead of another round of ad hoc
 * header buttons. Pure layout/composition - all state stays owned by
 * Layout.tsx, passed in and reported back out via callbacks. */
export function Toolbar({
  mode,
  onModeChange,
  tab,
  onTabChange,
  zoomPercent,
  onFitView,
  addBedForm,
  armedPlant,
  onClearArmedPlant,
  plantPicker,
  placementMode,
  onPlacementModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  viewAsOfDate,
  onViewAsOfDateChange,
  viewDateRange,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <RadioToggleGroup ariaLabel="View mode" value={mode} onChange={onModeChange} options={VIEW_MODE_OPTIONS} />
          {mode === "mine" && <TabToggleGroup value={tab} onChange={onTabChange} options={TAB_OPTIONS} />}
        </div>
        <div className="flex items-center gap-2">
          {mode === "mine" && (
            <>
              <Tooltip content="Undo last move/resize (Ctrl+Z)">
                <Button size="sm" variant="outline" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
                  <Undo2 />
                </Button>
              </Tooltip>
              <Tooltip content="Redo (Ctrl+Shift+Z)">
                <Button size="sm" variant="outline" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
                  <Redo2 />
                </Button>
              </Tooltip>
            </>
          )}
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(zoomPercent)}%</span>
          <Tooltip content="Fit the whole garden in view">
            <Button size="sm" variant="outline" onClick={onFitView}>
              <Maximize /> Fit view
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-h-7 items-center gap-2">
        {mode === "mine" && tab === "planters" && addBedForm}
        {mode === "mine" && tab === "plants" && (
          <>
            {plantPicker}
            {armedPlant && (
              <>
                <RadioToggleGroup
                  ariaLabel="Placement mode"
                  value={placementMode}
                  onChange={onPlacementModeChange}
                  options={PLACEMENT_MODE_OPTIONS}
                />
                <Button size="sm" variant="ghost" onClick={onClearArmedPlant}>
                  Clear
                </Button>
              </>
            )}
          </>
        )}
        {mode === "example" && (
          <DateScrubber value={viewAsOfDate} onChange={onViewAsOfDateChange} minDate={viewDateRange.min} maxDate={viewDateRange.max} />
        )}
      </div>
    </div>
  );
}
