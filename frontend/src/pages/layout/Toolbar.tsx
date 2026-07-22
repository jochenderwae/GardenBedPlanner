import type { RefObject } from "react";
import { Maximize, Plus, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioToggleGroup, TabToggleGroup } from "@/components/ui/toggle-group";
import { Tooltip } from "@/components/ui/tooltip";
import type { Plant } from "@/api/client";
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
  onAddBed: () => void;
  armedPlant: Plant | null;
  onClearArmedPlant: () => void;
  plantPickerAnchorRef: RefObject<HTMLDivElement | null>;
  onOpenPlantPicker: () => void;
  placementMode: PlacementMode;
  onPlacementModeChange: (mode: PlacementMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** The canvas editor's top-of-canvas control area, split into two always-
 * present rows so navigation never reflows when a mode's tool set changes
 * size (see the backlog item this was built for - a single flex row used to
 * wrap the tab switcher onto a second line once the Plants tab's tools grew
 * wide enough).
 *
 * Row 1 - navigation, always the same width regardless of mode/tab: view
 * mode (Edit your own beds / View the read-only example garden), the
 * Garden/Beds/Plants/Equipment tab switcher, zoom readout + "Fit view".
 *
 * Row 2 - whichever tools are specific to the active mode/tab (Add bed on
 * the Beds tab; pick-a-plant + Point/Row/Area mode on the Plants tab).
 * Always rendered (with a fixed min-height even when it has no tools for
 * the current tab) so switching tabs never causes row 1 to jump up/down.
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
  onAddBed,
  armedPlant,
  onClearArmedPlant,
  plantPickerAnchorRef,
  onOpenPlantPicker,
  placementMode,
  onPlacementModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
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
        {mode === "mine" && tab === "planters" && (
          <Button size="sm" onClick={onAddBed}>
            <Plus /> Add bed
          </Button>
        )}
        {mode === "mine" && tab === "plants" && (
          <>
            <div ref={plantPickerAnchorRef}>
              <Button size="sm" variant={armedPlant ? "outline" : "default"} onClick={onOpenPlantPicker}>
                {armedPlant ? armedPlant.common_name : "Pick a plant"}
              </Button>
            </div>
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
      </div>
    </div>
  );
}
