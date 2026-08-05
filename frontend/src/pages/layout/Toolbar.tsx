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
 * garden, then place footprint objects - beds, compost bins, decorations -
 * within it, then plants, then equipment last) and the tab-implied-locking
 * sequence: each tab makes only its own object type interactive
 * (`GardenBoundary`/`BedNode`/`DecorationLayer`/`PlantPlacementLayer`/
 * `EquipmentLayer` each gate on exactly one tab), which - since only one
 * tab can be active at a time - automatically locks every *other* step,
 * not just the immediately-preceding one. The user can always switch back
 * to an earlier tab to edit it again; nothing here prevents that.
 *
 * "planters" is kept as the internal `PlacementTab` value even though the
 * visible label is now "Objects" (#242) - purely a label change, minimizing
 * churn across every other file that branches on this value. */
export type PlacementTab = "garden" | "planters" | "plants" | "equipment";

const TAB_LABELS: Record<PlacementTab, string> = {
  garden: "Garden",
  planters: "Objects",
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
  /** The Objects tab's three creation triggers (Add bed/Add compost bin/
   * Add decoration), each its own trigger button + dialog, as one
   * self-contained fragment (built and passed in by `Layout.tsx`) - not a
   * plain callback the way this used to work, so each actual clickable
   * button can be a real `Dialog.Trigger` (see `dialog.tsx`'s own doc on
   * why that's load-bearing for focus-return-on-close, not just a styling
   * choice - #144's own follow-up bug report). Was a single `AddBedForm`
   * slot before #242 split the Objects tab into three creation buttons. */
  objectsToolbar: ReactNode;
  /** The Equipment tab's "Quick add" trigger + popover (`QuickAddEquipment`,
   * #242) - one-click create-and-place-in-garden for garden-bound equipment
   * (rain barrel, pathway, etc.). Same lifted-up-render-prop pattern as
   * `objectsToolbar` above. */
  equipmentQuickAdd: ReactNode;
  /** #250: the irrigation part (or unplaced legacy instance) currently
   * armed for click-to-place on the canvas (`IrrigationLayer.tsx`'s
   * `ArmedIrrigationTarget`, arming itself happens from
   * `IrrigationPartsPanel.tsx`'s side panel, not this toolbar) - `null`
   * label text means nothing's armed. Mirrors `armedPlant`/
   * `onClearArmedPlant`'s identical Plants-tab indicator+clear pattern,
   * superseding the old `pipeNetworkTrigger` dialog-opening button this
   * replaced (`PipeNetworkDialog.tsx` is retired as of #250). */
  armedIrrigationLabel: string | null;
  onClearArmedIrrigation: () => void;
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
 * snapshot of your real garden - see #180), the Garden/Objects/Plants/
 * Equipment tab switcher, zoom readout + "Fit view".
 *
 * Row 2 - whichever tools are specific to the active mode/tab (Add bed/Add
 * compost bin/Add decoration on the Objects tab; Quick add + armed-part
 * indicator on the Equipment tab, #250; pick-a-plant + Point/Row/Area mode on
 * the Plants tab; the date scrubber on the View tab). Always rendered (with a
 * fixed
 * min-height even when it has no tools for the current tab) so switching
 * tabs never causes row 1 to jump up/down.
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
  objectsToolbar,
  equipmentQuickAdd,
  armedIrrigationLabel,
  onClearArmedIrrigation,
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
        {mode === "mine" && tab === "planters" && objectsToolbar}
        {mode === "mine" && tab === "equipment" && (
          <>
            {equipmentQuickAdd}
            {armedIrrigationLabel && (
              <>
                <span className="text-xs text-muted-foreground">
                  Placing <span className="font-medium text-foreground">{armedIrrigationLabel}</span> - click a bed or open garden
                  space.
                </span>
                <Button size="sm" variant="ghost" onClick={onClearArmedIrrigation}>
                  Clear
                </Button>
              </>
            )}
          </>
        )}
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
