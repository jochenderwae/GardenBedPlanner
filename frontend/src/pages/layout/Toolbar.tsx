import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { Maximize, Plus } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
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
}

/** The canvas editor's single top-of-canvas control row - view mode
 * (My beds/Example garden), the Garden/Beds/Plants/Equipment tab switcher,
 * zoom readout + "Fit view", and whichever tab-specific tools are active
 * (Add bed on the Beds tab; pick-a-plant + Point/Row/Area mode on the
 * Plants tab). Consolidated out of what used to be ad hoc JSX directly in
 * Layout.tsx specifically so future tool-mode controls (pan/select, once
 * those land) have one obvious home to slot into instead of another round
 * of ad hoc header buttons. Pure layout/composition - all state stays
 * owned by Layout.tsx, passed in and reported back out via callbacks. */
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
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
        <h1 className="text-xl font-medium">Bed layout</h1>
        <div className="flex rounded-md border p-0.5">
          <button
            type="button"
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium",
              mode === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => onModeChange("mine")}
          >
            My beds
          </button>
          <button
            type="button"
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium",
              mode === "example" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => onModeChange("example")}
          >
            Example garden
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
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(zoomPercent)}%</span>
        <Button size="sm" variant="outline" onClick={onFitView} title="Fit the whole garden in view">
          <Maximize /> Fit view
        </Button>
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
