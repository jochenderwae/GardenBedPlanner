import type { RefObject } from "react";
import { Maximize, Plus, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const PLACEMENT_MODE_LABELS: Record<PlacementMode, string> = {
  individual: "Point",
  row: "Row",
  field: "Area",
};

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
          <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                mode === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
              onClick={() => onModeChange("mine")}
            >
              Edit
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                mode === "example" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
              onClick={() => onModeChange("example")}
            >
              View
            </button>
          </div>
          {mode === "mine" && (
            <div className="flex rounded-md border p-0.5">
              {(Object.keys(TAB_LABELS) as PlacementTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium",
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                  onClick={() => onTabChange(t)}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === "mine" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo last move/resize (Ctrl+Z)"
                aria-label="Undo"
              >
                <Undo2 />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
              >
                <Redo2 />
              </Button>
            </>
          )}
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(zoomPercent)}%</span>
          <Button size="sm" variant="outline" onClick={onFitView} title="Fit the whole garden in view">
            <Maximize /> Fit view
          </Button>
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
                <div className="flex rounded-md border p-0.5">
                  {(Object.keys(PLACEMENT_MODE_LABELS) as PlacementMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium",
                        placementMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                      )}
                      onClick={() => onPlacementModeChange(m)}
                    >
                      {PLACEMENT_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
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
