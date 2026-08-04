import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Line, Rect } from "react-konva";
import Konva from "konva";
import { useSnackbar } from "@/components/Snackbar";

// Konva defaults `dragButtons` to `[0, 1]` (left AND middle) - see
// Konva.Node's `_startDrag`, which only skips a mousedown-turned-drag when
// the button ISN'T in this list. That meant every draggable node here (bed
// Rects, polygon vertex Circles/Lines, planting markers) would start its own
// Konva-level drag on a middle-mouse-down too, racing the app's own
// window-level pan handling below (`handlePanMouseDown`/`isPanning`) - a
// middle-drag starting on top of a bed would nudge it by one grid-snap step
// before the pan took over (backlog #14's follow-up bug). Restricting to
// button 0 (left) only, once, module-wide, is the one-line fix; per-node
// button filtering isn't needed since nothing here wants middle-button drag
// on shapes, only the app-level pan.
Konva.dragButtons = [0];
import {
  checkPlacement,
  checkRotation,
  createPlanting,
  getGarden,
  listBedEquipment,
  listBeds,
  listDecorations,
  listEquipmentTypes,
  listPlantings,
  listPlants,
  putGarden,
  updateBed,
  updateBedEquipment,
  updateDecoration,
  updatePlanting,
  type Bed,
  type BedEquipment,
  type BedEquipmentUpdate,
  type BedUpdate,
  type CompanionMatch,
  type Decoration,
  type DecorationUpdate,
  type Garden,
  type GardenPut,
  type Geometry,
  type PlacementCheck,
  type PlacementType,
  type Plant,
  type Planting,
  type PlantingUpdate,
  type PolygonGeometry,
  type RotationWarning,
  type ShadeWarning,
} from "@/api/client";
import { BedNode } from "./layout/BedNode";
import { BedPanel, type BedPanelHandle } from "./layout/BedPanel";
import { AddBedForm } from "./layout/AddBedForm";
import { AddCompostBinForm } from "./layout/AddCompostBinForm";
import { AddDecorationForm } from "./layout/AddDecorationForm";
import { BulkPlantingPanel, type BulkPlantingPanelHandle } from "./layout/BulkPlantingPanel";
import { compassBoundingBox, compassCenter, CompassWidget } from "./layout/CompassWidget";
import { DecorationLayer } from "./layout/DecorationLayer";
import { DecorationPanel, type DecorationPanelHandle } from "./layout/DecorationPanel";
import { findEquipmentType } from "./layout/equipmentTypes";
import { GardenBoundary } from "./layout/GardenBoundary";
import { GardenPanel } from "./layout/GardenPanel";
import { GardenSnapshotLayer } from "./layout/GardenSnapshotView";
import { EquipmentLayer } from "./layout/EquipmentLayer";
import { DEFAULT_EQUIPMENT_SIZE_CM, EquipmentPanel } from "./layout/EquipmentPanel";
import { GrowthHabitLegend } from "./layout/GrowthHabitLegend";
import { OnboardingPrompt } from "./layout/OnboardingPrompt";
import { PipeNetworkDialog } from "./layout/PipeNetworkDialog";
import { QuickAddEquipment } from "./layout/QuickAddEquipment";
import { SoilRotationDialog } from "./layout/SoilRotationDialog";
import { PlantPlacementLayer, type PlacementMode, type PlantPlacementLayerHandle } from "./layout/PlantPlacementLayer";
import { PlantPicker } from "./layout/PlantPicker";
import { PlantingPanel, type PlantingPanelHandle } from "./layout/PlantingPanel";
import { PlantingTooltip, type PlantingTooltipState } from "./layout/PlantingTooltip";
import {
  defaultScrubberRange,
  isPlantingActiveAsOf,
  isPlantingVisibleOnEditTab,
  plantingStartVisualState,
  removalVisualState,
  todayIsoDate,
} from "./layout/plantingLifecycle";
import { RulerLayer } from "./layout/RulerLayer";
import { Toolbar, type PlacementTab, type ViewMode } from "./layout/Toolbar";
import {
  boundingRect,
  CANVAS_HEIGHT_PX,
  CANVAS_WIDTH_PX,
  clampPointToBounds,
  clampRectPositionToBounds,
  DRAG_SNAP_CM,
  effectivePlantSpacing,
  GRID_SPACING_CM,
  normalizedRect,
  NUDGE_STEP_CM,
  plantingsOutsideBounds,
  rectanglesOverlap,
  translateGeometry,
} from "./layout/geometry";
import { useUndoHistory } from "./layout/history";
import { useContainerSize } from "./layout/useContainerSize";
import {
  clampScale,
  DEFAULT_VIEWPORT,
  fitViewport,
  visibleWorldBounds,
  zoomAtPoint,
  type Size,
  type Viewport,
} from "./layout/viewport";

const CANVAS_SIZE: Size = { width: CANVAS_WIDTH_PX, height: CANVAS_HEIGHT_PX };
/** Multiplicative step per wheel-zoom tick - matches the standard
 * Figma/Konva pointer-relative wheel-zoom feel (small, smooth increments
 * rather than jumping between fixed zoom levels). */
const ZOOM_STEP = 1.05;

/** Grid lines across whatever's currently visible (not a fixed world
 * extent) - see RulerLayer's identical rationale. Stroke width compensates
 * for the Stage's own scale so lines read as a constant ~1px regardless of
 * zoom level. */
function GridLines({ canvasSize, viewport }: { canvasSize: Size; viewport: Viewport }) {
  const bounds = visibleWorldBounds(viewport, canvasSize);
  const strokeWidth = 1 / viewport.scale;
  const lines = useMemo(() => {
    const startX = Math.floor(bounds.x / GRID_SPACING_CM) * GRID_SPACING_CM;
    const endX = bounds.x + bounds.width;
    const startY = Math.floor(bounds.y / GRID_SPACING_CM) * GRID_SPACING_CM;
    const endY = bounds.y + bounds.height;
    const vertical = [];
    for (let x = startX; x <= endX; x += GRID_SPACING_CM) {
      vertical.push(
        <Line key={`v${x}`} points={[x, bounds.y, x, bounds.y + bounds.height]} stroke="#e5e7eb" strokeWidth={strokeWidth} />,
      );
    }
    const horizontal = [];
    for (let y = startY; y <= endY; y += GRID_SPACING_CM) {
      horizontal.push(
        <Line key={`h${y}`} points={[bounds.x, y, bounds.x + bounds.width, y]} stroke="#e5e7eb" strokeWidth={strokeWidth} />,
      );
    }
    return [...vertical, ...horizontal];
  }, [bounds.x, bounds.y, bounds.width, bounds.height, strokeWidth]);
  return <>{lines}</>;
}

/** Simple cascading placement for a newly-added footprint object (bed,
 * compost bin, decoration - #242) so it doesn't land exactly on top of an
 * existing one - just a starting point, the user drags it wherever it
 * actually belongs. Takes a plain count rather than a specific array so
 * `AddCompostBinForm`/`AddDecorationForm` can each cascade against their own
 * object count independently, same as `AddBedForm` always has. */
function nextObjectPosition(count: number): { pos_x: number; pos_y: number } {
  const offset = (count % 8) * 30;
  return { pos_x: 20 + offset, pos_y: 20 + offset };
}

// #174: placement-warning/good-companion indicator plumbing. See that
// issue's own design-spec comment (GH issue #174) for the full rationale -
// summarized inline below at each piece's own use site.

/** Appends `reason` to `map`'s array entry for `id`, creating it if absent -
 * always via a fresh array (never mutating an existing one in place), since
 * callers reuse this against `new Map(prev)` shallow copies whose array
 * *values* would otherwise still be shared with the previous React state
 * snapshot. */
function addReason(map: Map<number, string[]>, id: number, reason: string) {
  const existing = map.get(id);
  map.set(id, existing ? [...existing, reason] : [reason]);
}

/** A bed-local candidate geometry centered on the bed's own bounding-box
 * centroid - the arm-time approximation #174's design spec calls for
 * ("the real eventual position is unknown yet... an acceptable, stated
 * trade-off for 'as soon as armed' feedback"). `boundingRect` already
 * returns bed-local width/height regardless of whether the bed itself is a
 * rectangle or polygon (see that function's own doc) - only its magnitude
 * matters here, not its (necessarily world-space) x/y. */
function bedCentroidGeometry(bed: Bed, thicknessCm: number): Geometry {
  const localSize = boundingRect(bed.border_geometry);
  return {
    type: "rectangle",
    x: localSize.width / 2 - thicknessCm / 2,
    y: localSize.height / 2 - thicknessCm / 2,
    width: thicknessCm,
    height: thicknessCm,
    rotation: 0,
  };
}

/** Rotation-conflict reason line, from the perspective of whichever marker
 * actually violates the rule - `RotationWarning.conflicting_*` fields
 * always describe the *other* (pre-existing) planting, matching #174's
 * design spec's canonical copy exactly when attached to the newly-placed
 * candidate's own marker (commit-time - see `plantingCreateMutation` below).
 * Not reused for the arm-time "flag the already-placed conflicting planting
 * itself" case (see `rotationReasonForExisting` below) - self-referencing
 * "same family as itself" would read as nonsense on that marker's own
 * tooltip.
 *
 * #229: a conflict can now be *inherited* via a logged soil-rotation
 * transfer rather than grown directly in this bed - `warning.
 * conflicting_via_soil_transfer`/`conflicting_source_bed_id` distinguish the
 * two so the tooltip can name where the risk actually came from ("soil
 * moved here from {bed}") instead of implying this bed grew the conflicting
 * crop itself. The " - " separator matches this file's own existing
 * appended-detail convention (see the antagonist/companion reason strings
 * below), not a new punctuation pattern. Only the arm-time-anchored-to-an-
 * existing-planting case (`rotationReasonForExisting`) has no inherited-only
 * equivalent yet - see #232. */
function rotationReasonForCandidate(warning: RotationWarning, bedsById: Map<number, Bed>): string | null {
  if (!warning.has_warning) return null;
  const name = warning.conflicting_plant_common_name ?? warning.conflicting_plant_slug ?? "a recent planting";
  const datePart = warning.conflicting_planted_date ? ` (planted ${warning.conflicting_planted_date})` : "";
  if (warning.conflicting_via_soil_transfer && warning.conflicting_source_bed_id != null) {
    const sourceBedName = bedsById.get(warning.conflicting_source_bed_id)?.name ?? "another bed";
    return `Rotation: same family as ${name}${datePart} - soil moved here from ${sourceBedName}`;
  }
  return `Rotation: same family as ${name}${datePart}`;
}

/** Rotation-conflict reason line for the *already-placed* conflicting
 * planting's own marker (arm-time speculative check) - phrased around the
 * armed candidate species instead of the (self-referential) conflicting
 * plant fields. */
function rotationReasonForExisting(candidateName: string): string {
  return `Rotation: same family as ${candidateName}, which you're about to place here`;
}

/** Splits one `PlacementCheck` result into every reason line it implies,
 * from both directions - `candidateWarnings`/`candidateGoodCompanions` for
 * the placement being checked itself (only used at commit time - see
 * #174's design spec's "What does not get a checkmark" section for why the
 * candidate never gets a checkmark, only ever a warning), and
 * `neighborWarnings`/`neighborGoodCompanions` (keyed by each matched
 * neighbor planting's own id) for the already-placed plantings it's an
 * antagonist/shade-risk/companion to - used both at commit time and by the
 * arm-time/drag-time speculative check (which only ever has neighbors to
 * anchor an icon to - the not-yet-placed candidate has no marker yet). */
function describePlacementCheck(
  check: PlacementCheck,
  candidateName: string,
): {
  candidateWarnings: string[];
  candidateGoodCompanions: string[];
  neighborWarnings: Map<number, string[]>;
  neighborGoodCompanions: Map<number, string[]>;
} {
  const candidateWarnings: string[] = [];
  const candidateGoodCompanions: string[] = [];
  const neighborWarnings = new Map<number, string[]>();
  const neighborGoodCompanions = new Map<number, string[]>();

  function antagonistDetail(match: CompanionMatch): string {
    return match.mechanism ? ` - ${match.mechanism}` : "";
  }
  for (const match of check.antagonists) {
    const detail = antagonistDetail(match);
    candidateWarnings.push(`Antagonist: inhibits ${match.neighbor_plant_common_name}${detail}`);
    addReason(neighborWarnings, match.neighbor_planting_id, `Antagonist: inhibits ${candidateName}${detail}`);
  }

  function shadeForCandidate(shade: ShadeWarning): string {
    return shade.direction === "shaded_by_neighbor"
      ? `Shade risk: ${shade.neighbor_plant_common_name} may shade this spot`
      : `Shade risk: may shade ${shade.neighbor_plant_common_name}`;
  }
  function shadeForNeighbor(shade: ShadeWarning): string {
    return shade.direction === "shaded_by_neighbor"
      ? `Shade risk: may shade ${candidateName}`
      : `Shade risk: ${candidateName} may shade this spot`;
  }
  for (const shade of check.shade_warnings) {
    candidateWarnings.push(shadeForCandidate(shade));
    addReason(neighborWarnings, shade.neighbor_planting_id, shadeForNeighbor(shade));
  }

  function companionDetail(match: CompanionMatch): string {
    const detail = match.mechanism ?? match.notes;
    return detail ? ` - ${detail}` : " - beneficial pairing";
  }
  for (const match of check.companions) {
    const detail = companionDetail(match);
    candidateGoodCompanions.push(`Pairs well with ${match.neighbor_plant_common_name}${detail}`);
    addReason(neighborGoodCompanions, match.neighbor_planting_id, `Pairs well with ${candidateName}${detail}`);
  }

  return { candidateWarnings, candidateGoodCompanions, neighborWarnings, neighborGoodCompanions };
}

export function Layout() {
  const queryClient = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // A selected decoration (#242) - kept separate from the bed's own
  // `selectedId` (different object type, different id space) but mutually
  // exclusive with it in the UI: selecting one clears the other, so only one
  // of BedPanel/DecorationPanel ever shows at a time on the Objects tab.
  const [selectedDecorationId, setSelectedDecorationId] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>("mine");
  const [tab, setTab] = useState<PlacementTab>("garden");
  // View tab's date scrubber (#180) - drives which of the garden's real
  // Bed/Planting rows are actually "in the ground" as of that date (see
  // isPlantingActiveAsOf below). Defaults to today; only meaningful while
  // mode === "example" (the tab's own toolbar control is gated the same way
  // - see Toolbar.tsx).
  const [viewAsOfDate, setViewAsOfDate] = useState<string>(todayIsoDate());
  // First-run "seed the example garden?" prompt (see OnboardingPrompt.tsx) -
  // dismissing (either "start from scratch" or a successful seed) hides it
  // for the rest of this page load; no persisted flag, so a later reload
  // with beds still empty prompts again (see that component's own doc).
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // "Arm" a plant, then draw where it goes (point/row/area) - see
  // PlantPlacementLayer's own doc. `PlantPicker` (rendered via Toolbar's
  // `plantPicker` slot below) owns which plant gets armed *from*, including
  // its own open/close state - it isn't tied to a canvas click position the
  // way the old click-first flow's picker was.
  const [armedPlant, setArmedPlant] = useState<Plant | null>(null);
  const [placementMode, setPlacementMode] = useState<PlacementMode>("individual");
  // Clicking a placed plant marker opens its edit/details popup
  // (PlantingPanel), matching how clicking a bed opens BedPanel.
  const [selectedPlantingId, setSelectedPlantingId] = useState<number | null>(null);
  // Multi-selection (marquee-drag or shift-click, see PlantPlacementLayer) -
  // separate from the single-select-and-edit `selectedPlantingId` above.
  // Non-empty whenever BulkPlantingPanel is showing instead of PlantingPanel.
  const [selectedPlantingIds, setSelectedPlantingIds] = useState<Set<number>>(new Set());
  const [tooltip, setTooltip] = useState<PlantingTooltipState | null>(null);
  // Placement-warning/good-companion indicators (#26/#174) - see #174's own
  // design-spec comment for the full rationale. Two sources feed the same
  // pair of icons (PlantPlacementLayer's WarningTriangle/CompanionCheckmark):
  // - "Committed": permanent, written once a placement is actually saved
  //   (plantingCreateMutation's onSuccess below) - #26's original
  //   rotation-only mechanism, generalized to also cover antagonist/shade
  //   companion checks.
  // - "Speculative": live, only while a candidate plant is armed - see the
  //   `armedPlant`-driven effect and `handleDrawGeometryChange` below.
  //   Keyed *by bed* (not flattened into one big map) so a live drag in one
  //   bed only ever refines/replaces that bed's own entry, never clobbering
  //   another bed's arm-time approximation.
  const [committedWarnings, setCommittedWarnings] = useState<Map<number, string[]>>(new Map());
  const [committedGoodCompanions, setCommittedGoodCompanions] = useState<Map<number, string[]>>(new Map());
  const [speculativeByBed, setSpeculativeByBed] = useState<
    Map<number, { warnings: Map<number, string[]>; goodCompanions: Map<number, string[]> }>
  >(new Map());
  // Combines committed + every bed's current speculative result into the
  // one pair of maps PlantPlacementLayer actually renders from - it doesn't
  // need to know or care which source produced a given entry (see #174's
  // design spec's own "both write into the same maps" note). A planting id
  // can validly accumulate reasons from both sources at once (e.g. it has
  // an old committed rotation conflict *and* is now also a speculative
  // antagonist match for whatever's freshly armed) - concatenated, not
  // overwritten.
  const plantingWarnings = useMemo(() => {
    const merged = new Map<number, { reasons: string[] }>();
    for (const [id, reasons] of committedWarnings) merged.set(id, { reasons: [...reasons] });
    for (const { warnings } of speculativeByBed.values()) {
      for (const [id, reasons] of warnings) {
        const existing = merged.get(id);
        merged.set(id, { reasons: existing ? [...existing.reasons, ...reasons] : reasons });
      }
    }
    return merged;
  }, [committedWarnings, speculativeByBed]);
  const plantingGoodCompanions = useMemo(() => {
    const merged = new Map<number, { neighbors: string[] }>();
    for (const [id, neighbors] of committedGoodCompanions) merged.set(id, { neighbors: [...neighbors] });
    for (const { goodCompanions } of speculativeByBed.values()) {
      for (const [id, neighbors] of goodCompanions) {
        const existing = merged.get(id);
        merged.set(id, { neighbors: existing ? [...existing.neighbors, ...neighbors] : neighbors });
      }
    }
    return merged;
  }, [committedGoodCompanions, speculativeByBed]);
  // Imperative handles onto the currently-open panel so the global
  // Delete-key handler below can trigger the exact same confirm-dialog-open
  // action as that panel's own trash button - see the "Keyboard shortcuts"
  // backlog item.
  const bedPanelRef = useRef<BedPanelHandle>(null);
  const decorationPanelRef = useRef<DecorationPanelHandle>(null);
  const plantingPanelRef = useRef<PlantingPanelHandle>(null);
  const bulkPlantingPanelRef = useRef<BulkPlantingPanelHandle>(null);
  const plantPlacementRef = useRef<PlantPlacementLayerHandle>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  // The canvas Stage tracks whichever wrapper div is currently mounted
  // ("mine" mode or "example" mode - only one renders at a time, see the
  // JSX below) instead of a fixed CANVAS_WIDTH_PX/HEIGHT_PX, so it fills the
  // actual space available rather than producing page-level scroll bars
  // whenever the fixed size didn't match the viewport (see the "No scroll
  // bars in Bed Layout screen" backlog item).
  const { ref: canvasContainerRef, size: canvasSize } = useContainerSize(CANVAS_SIZE);
  // Middle-mouse-drag pan (see handlePanMouseDown below) - Stage's own
  // `draggable` used to own panning, but that conflicts with child nodes
  // (beds, polygon vertices, plant markers) that are themselves draggable:
  // Konva only tracks one active drag gesture at a time, and stopping the
  // Stage's drag mid-gesture to "guard" it ends up cancelling the child
  // node's own just-started drag instead of isolating it (see the "pan/drag
  // bug" backlog item this replaced). Panning is now handled entirely
  // outside Konva's drag system: `isPanning` just controls whether the
  // window-level mousemove/mouseup listeners below are subscribed,
  // `lastPanPointRef` tracks the raw (untransformed) pointer position
  // between ticks.
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null);
  // Left-drag-over-empty-canvas marquee select for the Planters tab (see
  // PlantPlacementLayer's identical pattern for the Plants tab, which is
  // bed-scoped rather than canvas-wide since plants only ever live inside a
  // bed). World/cm coordinates (Stage-relative, already accounts for
  // pan/zoom via getRelativePointerPosition).
  const [bedMarquee, setBedMarquee] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null,
  );
  // Multi-bed highlight from a marquee that overlapped 2+ beds - kept
  // separate from the single-select `selectedId` (which still drives
  // BedPanel) since there's no bulk-bed-edit panel yet; a marquee hitting
  // exactly one bed still goes through `selectedId` as before so a plain
  // click-drag-release over one bed behaves like a normal select.
  const [selectedBedIds, setSelectedBedIds] = useState<Set<number>>(new Set());
  // Undo/redo over the four geometry-mutation call sites below (bed, garden
  // boundary, planting, equipment) - see history.ts's own doc for why this
  // is a small linear stack rather than a full command-pattern engine.
  const history = useUndoHistory();

  useEffect(() => {
    if (!isPanning) return;
    function handleMouseMove(e: MouseEvent) {
      const last = lastPanPointRef.current;
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      setViewport((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    function handleMouseUp() {
      setIsPanning(false);
      lastPanPointRef.current = null;
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning]);

  /** Middle mouse button (button 1) down anywhere on a Stage starts a pan -
   * shared by both Stage instances ("mine" and "example" mode). Returns
   * whether it handled the event, so callers with additional left-click
   * logic (the "mine" Stage's marquee-select) know to skip that when this
   * already consumed it. `preventDefault` stops the browser's own
   * middle-click autoscroll cursor from kicking in over the canvas. */
  function handlePanMouseDown(e: Konva.KonvaEventObject<MouseEvent>): boolean {
    if (e.evt.button !== 1) return false;
    e.evt.preventDefault();
    lastPanPointRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    setIsPanning(true);
    return true;
  }

  // Beds/garden/plantings are fetched unconditionally now - both the Edit
  // ("mine") and View ("example") tabs render the same real data, just
  // filtered to a different as-of date (see editablePlantings/viewPlantings
  // below, #180). Only equipment stays Edit-tab-only; the View tab doesn't
  // show it.
  const { data, isPending, isError } = useQuery({
    queryKey: ["beds"],
    queryFn: listBeds,
  });
  const gardenQuery = useQuery({
    queryKey: ["garden"],
    queryFn: getGarden,
  });
  const plantingsQuery = useQuery({
    queryKey: ["plantings"],
    queryFn: listPlantings,
  });
  const equipmentQuery = useQuery({
    queryKey: ["bed-equipment"],
    queryFn: listBedEquipment,
    enabled: mode === "mine",
  });
  // Reference lookup for a placed item's real default shape/height (#208) -
  // Edit-tab-only, same gating as equipmentQuery above.
  const equipmentTypesQuery = useQuery({
    queryKey: ["equipment-types"],
    queryFn: listEquipmentTypes,
    enabled: mode === "mine",
  });
  // Decorations (#242) - Edit-tab-only, same gating as equipment above (the
  // View tab's read-only snapshot doesn't render them - purely cosmetic
  // objects have no "was this here as of this date" history worth
  // scrubbing through).
  const decorationsQuery = useQuery({
    queryKey: ["decorations"],
    queryFn: listDecorations,
    enabled: mode === "mine",
  });
  const plantsQuery = useQuery({
    queryKey: ["plants"],
    queryFn: () => listPlants(500),
  });

  const plantsBySlug = useMemo(() => {
    const map = new Map<string, Plant>();
    for (const plant of plantsQuery.data ?? []) map.set(plant.slug, plant);
    return map;
  }, [plantsQuery.data]);

  const geometryMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BedUpdate }) => updateBed(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) =>
        old ? old.map((b) => (b.id === updated.id ? updated : b)) : old,
      );
    },
  });

  const gardenGeometryMutation = useMutation({
    mutationFn: (payload: GardenPut) => putGarden(payload),
    onSuccess: (updated) => queryClient.setQueryData<Garden>(["garden"], updated),
  });

  const plantingCreateMutation = useMutation({
    mutationFn: (payload: { bed_id: number; plant_slug: string; placement_type: PlacementType; geometry: Geometry }) =>
      createPlanting({ ...payload, planted_date: null, removed_date: null }),
    onSuccess: (created) => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) => (old ? [...old, created] : [created]));
      if (created.id == null) return;
      const plantingId = created.id;
      // The commit-time check below is now the authoritative result for
      // this bed - drop whatever the arm-time/drag-time speculative check
      // had guessed for it (#174's design spec: "Clear the speculative
      // per-arm state for that bed once this lands").
      setSpeculativeByBed((prev) => {
        if (!prev.has(created.bed_id)) return prev;
        const next = new Map(prev);
        next.delete(created.bed_id);
        return next;
      });
      const candidateName = plantsBySlug.get(created.plant_slug)?.common_name ?? created.plant_slug;
      // Fire-and-forget, both checks in parallel: flag the just-placed
      // planting itself if it repeats a same-family crop recently grown in
      // this bed (#26) or is an antagonist/shade-risk to an already-placed
      // neighbor (#174) - and flag that neighbor's own marker too. A failed
      // check (network hiccup, etc.) just means no warning shows - not
      // worth surfacing as an error for a purely advisory indicator.
      checkRotation(created.bed_id, created.plant_slug)
        .then((warning) => {
          const reason = rotationReasonForCandidate(warning, bedsById);
          if (!reason) return;
          setCommittedWarnings((prev) => {
            const next = new Map(prev);
            addReason(next, plantingId, reason);
            return next;
          });
        })
        .catch(() => {});
      checkPlacement(created.bed_id, created.plant_slug, created.geometry, { excludePlantingId: plantingId })
        .then((check) => {
          const { candidateWarnings, neighborWarnings, neighborGoodCompanions } = describePlacementCheck(check, candidateName);
          if (candidateWarnings.length > 0) {
            setCommittedWarnings((prev) => {
              const next = new Map(prev);
              for (const reason of candidateWarnings) addReason(next, plantingId, reason);
              return next;
            });
          }
          if (neighborWarnings.size > 0) {
            setCommittedWarnings((prev) => {
              const next = new Map(prev);
              for (const [id, reasons] of neighborWarnings) for (const reason of reasons) addReason(next, id, reason);
              return next;
            });
          }
          if (neighborGoodCompanions.size > 0) {
            setCommittedGoodCompanions((prev) => {
              const next = new Map(prev);
              for (const [id, reasons] of neighborGoodCompanions) for (const reason of reasons) addReason(next, id, reason);
              return next;
            });
          }
        })
        .catch(() => {});
    },
  });
  const plantingUpdateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PlantingUpdate }) => updatePlanting(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) =>
        old ? old.map((p) => (p.id === updated.id ? updated : p)) : old,
      );
    },
  });
  const equipmentGeometryMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BedEquipmentUpdate }) => updateBedEquipment(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) =>
        old ? old.map((e) => (e.id === updated.id ? updated : e)) : old,
      );
    },
  });
  const decorationGeometryMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: DecorationUpdate }) => updateDecoration(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Decoration[]>(["decorations"], (old) =>
        old ? old.map((d) => (d.id === updated.id ? updated : d)) : old,
      );
    },
  });

  const beds = data ?? [];
  const garden = gardenQuery.data ?? null;
  // Garden's own bounding box, in world/cm space - passed to every BedNode so
  // drag/resize/vertex-drag can be clamped to stay inside the garden's
  // boundary (see the "Bed placement must stay within the garden's
  // boundary" backlog item). Undefined when there's no garden set up yet.
  const gardenBounds = garden ? boundingRect(garden.border_geometry) : undefined;
  const plantings = plantingsQuery.data ?? [];
  const equipmentList = equipmentQuery.data ?? [];
  const equipmentTypes = equipmentTypesQuery.data ?? [];
  const decorations = decorationsQuery.data ?? [];
  const selectedBed = beds.find((b) => b.id === selectedId) ?? null;
  const selectedDecoration = decorations.find((d) => d.id === selectedDecorationId) ?? null;
  const selectedPlanting = plantings.find((p) => p.id === selectedPlantingId) ?? null;
  const today = todayIsoDate();
  // Edit tab (#180/#201): stays a fixed "today" view, no scrubber - a
  // planting whose removed_date has already passed just isn't drawn at all,
  // but (unlike the View tab below) one whose planted_date hasn't arrived
  // *yet* still is - see isPlantingVisibleOnEditTab's own doc for why this
  // is deliberately not the same isPlantingActiveAsOf filter the View tab
  // uses. A planting scheduled to leave later, or not yet planted, still
  // renders, with its own visual cue - see removalStateById/startStateById
  // below. Only affects what's rendered on the canvas; every other lookup
  // in this file (selectedPlanting, BulkPlantingPanel, handlePlantingMove,
  // ...) still reads off the full `plantings` array.
  const editablePlantings = plantings.filter((p) => isPlantingVisibleOnEditTab(p, today));
  const removalStateById = new Map(
    editablePlantings.filter((p) => p.id != null).map((p) => [p.id as number, removalVisualState(p, today)]),
  );
  const startStateById = new Map(
    editablePlantings.filter((p) => p.id != null).map((p) => [p.id as number, plantingStartVisualState(p, today)]),
  );
  // View tab (#180): the same real plantings, filtered to whatever was
  // actually in the ground as of the scrubber's own selected date instead
  // of always "today".
  const viewPlantings = plantings.filter((p) => isPlantingActiveAsOf(p, viewAsOfDate));
  const viewDateRange = defaultScrubberRange(plantings, today);
  // Every bed's bounding box, in world/cm space, keyed by id - so each
  // BedNode can be given every *other* bed's box for the "beds must not
  // intersect" hard constraint. Not memoized - the bed count here is a
  // small, fixed physical garden's worth, cheap to recompute per render.
  const bedRectsById = new Map(
    beds.filter((b) => b.id != null).map((b) => [b.id as number, boundingRect(b.border_geometry)]),
  );
  // #229: resolves a RotationWarning.conflicting_source_bed_id to its own
  // name for the provenance-aware tooltip clause below - same
  // list-then-Map-by-id convention every other id-resolution in this app
  // uses (e.g. TaskAgendaView.tsx's bedsById).
  const bedsById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b]));

  function switchTab(next: PlacementTab) {
    setTab(next);
    setSelectedId(null);
    setSelectedDecorationId(null);
    setSelectedBedIds(new Set());
    // No explicit PlantPicker-close needed here (unlike the old
    // plantPickerOpen state this replaced) - Toolbar.tsx only renders the
    // `plantPicker` slot while tab === "plants", so switching away from it
    // unmounts PlantPicker entirely, which resets its own internal open
    // state for free the next time this tab is switched back to.
    setSelectedPlantingId(null);
    setSelectedPlantingIds(new Set());
  }

  function handlePlantPlace(bedId: number, geometry: Geometry, placementType: PlacementType) {
    if (!armedPlant) return;
    plantingCreateMutation.mutate({ bed_id: bedId, plant_slug: armedPlant.slug, placement_type: placementType, geometry });
  }

  // #174: while a candidate plant is armed, speculatively check every bed
  // that already has at least one planting for a rotation conflict (exact,
  // bed-scoped) and a companion/antagonist/shade match (approximated
  // against that bed's own centroid until a real drag position exists -
  // see `handleDrawGeometryChange` below for the live refinement).
  // Cleared (empty map) whenever nothing is armed or the tab isn't Plants.
  useEffect(() => {
    if (tab !== "plants" || !armedPlant) {
      setSpeculativeByBed(new Map());
      return;
    }
    const candidate = armedPlant;
    const candidateName = candidate.common_name;
    const thickness = effectivePlantSpacing(null, candidate);
    // Depends on the raw query-cache data (stable across renders unless it
    // actually changes), not the `beds`/`plantings` locals derived from it
    // every render, so this effect doesn't refire on every keystroke/render
    // while a plant stays armed.
    const currentBeds = data ?? [];
    const currentPlantings = plantingsQuery.data ?? [];
    const bedsWithPlantings = currentBeds.filter((bed) => bed.id != null && currentPlantings.some((p) => p.bed_id === bed.id));
    let cancelled = false;
    Promise.all(
      bedsWithPlantings.map(async (bed) => {
        const bedId = bed.id as number;
        const [rotationResult, placementResult] = await Promise.allSettled([
          checkRotation(bedId, candidate.slug),
          checkPlacement(bedId, candidate.slug, bedCentroidGeometry(bed, thickness)),
        ]);
        const warnings = new Map<number, string[]>();
        const goodCompanions = new Map<number, string[]>();
        if (
          rotationResult.status === "fulfilled" &&
          rotationResult.value.has_warning &&
          rotationResult.value.conflicting_planting_id != null
        ) {
          addReason(warnings, rotationResult.value.conflicting_planting_id, rotationReasonForExisting(candidateName));
        }
        if (placementResult.status === "fulfilled") {
          const { neighborWarnings, neighborGoodCompanions } = describePlacementCheck(placementResult.value, candidateName);
          for (const [id, reasons] of neighborWarnings) for (const reason of reasons) addReason(warnings, id, reason);
          for (const [id, reasons] of neighborGoodCompanions) for (const reason of reasons) addReason(goodCompanions, id, reason);
        }
        return { bedId, warnings, goodCompanions };
      }),
    ).then((results) => {
      if (cancelled) return;
      setSpeculativeByBed(new Map(results.map((r) => [r.bedId, { warnings: r.warnings, goodCompanions: r.goodCompanions }])));
    });
    return () => {
      cancelled = true;
    };
  }, [armedPlant, tab, data, plantingsQuery.data]);

  // #174: refine the arm-time bed-centroid approximation the moment the
  // user actually starts drawing a row/field placement - re-runs the
  // companion/shade check (rotation isn't geometry-dependent, no need to
  // re-run it) against the live drag rectangle, debounced 150ms so a fast
  // drag doesn't spam the endpoint, and guarded (via an incrementing token)
  // against a stale response landing after a newer drag tick already
  // superseded it. Passed to PlantPlacementLayer as `onDrawGeometryChange`.
  const drawCheckTokenRef = useRef(0);
  const drawCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleDrawGeometryChange(bedId: number, geometry: Geometry) {
    if (!armedPlant) return;
    const candidate = armedPlant;
    if (drawCheckTimeoutRef.current != null) clearTimeout(drawCheckTimeoutRef.current);
    const token = ++drawCheckTokenRef.current;
    drawCheckTimeoutRef.current = setTimeout(() => {
      checkPlacement(bedId, candidate.slug, geometry)
        .then((check) => {
          if (drawCheckTokenRef.current !== token) return;
          const { neighborWarnings, neighborGoodCompanions } = describePlacementCheck(check, candidate.common_name);
          setSpeculativeByBed((prev) => {
            const next = new Map(prev);
            next.set(bedId, { warnings: neighborWarnings, goodCompanions: neighborGoodCompanions });
            return next;
          });
        })
        .catch(() => {});
    }, 150);
  }

  /** Ctrl/Cmd+scroll = pointer-relative zoom (matches Figma's convention,
   * avoids plain scroll fighting with page/panel scroll); plain scroll =
   * pan. `preventDefault` stops the browser page from scrolling/zooming
   * underneath the canvas. */
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const nextScale = direction > 0 ? viewport.scale * ZOOM_STEP : viewport.scale / ZOOM_STEP;
      setViewport(zoomAtPoint(viewport, pointer, clampScale(nextScale)));
    } else {
      setViewport((v) => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }));
    }
  }

  /** The "mine" Stage's own mousedown - middle button starts a pan (see
   * handlePanMouseDown); a left-button mousedown that lands on empty canvas
   * (not on a bed or any other interactive node - `e.target === stage`)
   * clears the current bed selection and starts a marquee-select drag: a bed
   * marquee on the Planters tab (tracked here directly), or a planting
   * marquee on the Plants tab (forwarded to `PlantPlacementLayer`'s
   * imperative handle) - beds are treated as static background for the
   * Plants-tab gesture too (#19's third round), so this fires from any
   * empty-canvas click regardless of tab, not just the Planters one. */
  function handleMineStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (handlePanMouseDown(e)) return;
    if (e.evt.button !== 0) return;
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    setSelectedId(null);
    setSelectedBedIds(new Set());
    if (tab === "planters") {
      const pos = stage.getRelativePointerPosition();
      if (pos) setBedMarquee({ start: pos, current: pos });
    } else if (tab === "plants") {
      const pos = stage.getRelativePointerPosition();
      if (pos) plantPlacementRef.current?.handleStageMouseDown(pos, e.evt.shiftKey);
    }
  }

  /** The "mine" Stage's own onMouseMove - drives whichever drag-in-progress
   * actually owns it: a bed marquee (Planters tab, tracked here directly) or
   * a planting draw/marquee (Plants tab, forwarded to
   * `PlantPlacementLayer`'s own imperative handle - see its doc for why a
   * plain per-bed-shape listener wasn't reliable enough, #19). Attached
   * directly to the Stage rather than any one shape so it keeps firing
   * (and the drag rectangle stays visible/tracking) even once the pointer
   * crosses outside whatever shape the drag started on. */
  function handleStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage();
    const pos = stage?.getRelativePointerPosition();
    if (!pos) return;
    if (bedMarquee) setBedMarquee((prev) => (prev ? { ...prev, current: pos } : prev));
    plantPlacementRef.current?.handleStageMouseMove(pos);
  }

  /** Same rationale as `handleStageMouseMove` for the Stage's own mouseup -
   * completes a bed marquee (every bed whose bounding box overlaps the
   * drawn rectangle gets selected: a single hit goes through the normal
   * `selectedId` so BedPanel opens, matching a plain click; 2+ hits are
   * highlighted via `selectedBedIds` instead, since there's no bulk-bed-edit
   * panel yet) or forwards to `PlantPlacementLayer` to complete its own
   * draw/marquee. */
  function handleStageMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage();
    const pos = stage?.getRelativePointerPosition();
    if (bedMarquee) {
      const resolvedPos = pos ?? bedMarquee.current;
      const rect = normalizedRect(bedMarquee.start, resolvedPos);
      const hitIds = beds
        .filter((b) => b.id != null && rectanglesOverlap(rect, boundingRect(b.border_geometry)))
        .map((b) => b.id as number);
      setBedMarquee(null);
      if (hitIds.length === 1) {
        setSelectedId(hitIds[0]);
        setSelectedBedIds(new Set());
      } else if (hitIds.length > 1) {
        setSelectedId(null);
        setSelectedBedIds(new Set(hitIds));
      }
    }
    if (pos) plantPlacementRef.current?.handleStageMouseUp(pos);
  }

  /** "Fit to garden": frame the garden boundary + every bed at the largest
   * zoom that keeps it all on screen - replaces "hope the fixed canvas is
   * big enough" with an actual answer. Beds/garden are the same real data
   * in both modes now (#180), so this no longer branches on `mode`. */
  function handleFitView() {
    const boxes = [
      ...(garden ? [boundingRect(garden.border_geometry)] : []),
      ...(gardenBounds ? [compassBoundingBox(gardenBounds)] : []),
      ...beds.map((b) => boundingRect(b.border_geometry)),
    ];
    setViewport(fitViewport(boxes, canvasSize));
  }

  /** Applies (and PATCHes) a bed's geometry - factored out of
   * handleBedChange so both the live drag/resize and undo/redo can share the
   * exact same optimistic-cache-then-mutate path. */
  function applyBedGeometry(bedId: number, geometry: Geometry) {
    // Optimistic: the Konva node already reflects the drag/resize/rotate
    // visually (Konva owns it during the gesture) - mirror that into the
    // query cache immediately so a re-render before the PATCH resolves
    // doesn't snap it back to the stale shape, then reconcile with the
    // server response.
    queryClient.setQueryData<Bed[]>(["beds"], (old) =>
      old ? old.map((b) => (b.id === bedId ? { ...b, border_geometry: geometry } : b)) : old,
    );
    geometryMutation.mutate({ id: bedId, patch: { border_geometry: geometry } });
  }

  /** Warns (doesn't silently re-clamp/move anything - see the "plantings
   * drifting outside their bed" backlog item, #198) when a bed's footprint
   * just shrank/reshaped enough to leave some of its own plantings outside
   * it. Only fires when the bed's own bounding size actually changed - a
   * plain drag (position only) never affects a planting's bed-local
   * coordinates, so it's never worth checking for that case. Uses
   * `boundingRect` for both rectangle and polygon beds (the same
   * bounding-box simplification already used elsewhere for a polygon's
   * rough extent), since a resized polygon can equally strand a planting
   * that used to sit inside it. */
  function warnIfPlantingsNowOutOfBounds(bed: Bed, previousGeometry: Geometry, nextGeometry: Geometry) {
    const previousRect = boundingRect(previousGeometry);
    const nextRect = boundingRect(nextGeometry);
    if (previousRect.width === nextRect.width && previousRect.height === nextRect.height) return;
    const bedPlantings = plantings.filter((p) => p.bed_id === bed.id);
    const outside = plantingsOutsideBounds(bedPlantings, nextRect.width, nextRect.height);
    if (outside.length === 0) return;
    showSnackbar(
      `${outside.length} planting${outside.length === 1 ? "" : "s"} in "${bed.name}" now ${outside.length === 1 ? "sits" : "sit"} outside its resized edges.`,
    );
  }

  function handleBedChange(bed: Bed, geometry: Geometry) {
    if (bed.id == null) return;
    const bedId = bed.id;
    const previousGeometry = bed.border_geometry;
    applyBedGeometry(bedId, geometry);
    history.push({
      undo: () => applyBedGeometry(bedId, previousGeometry),
      redo: () => applyBedGeometry(bedId, geometry),
    });
    warnIfPlantingsNowOutOfBounds(bed, previousGeometry, geometry);
  }

  /** A decoration's own drag/resize/rotate/vertex-drag (#242) - the fifth
   * of undo/redo's tracked geometry-mutation sites (bed, garden boundary,
   * planting, equipment, decoration), same optimistic-update-then-PATCH
   * shape as `applyBedGeometry` above. No `warnIfPlantingsNowOutOfBounds`
   * equivalent - a decoration never has plantings placed inside it. */
  function applyDecorationGeometry(decorationId: number, geometry: Geometry) {
    queryClient.setQueryData<Decoration[]>(["decorations"], (old) =>
      old ? old.map((d) => (d.id === decorationId ? { ...d, border_geometry: geometry } : d)) : old,
    );
    decorationGeometryMutation.mutate({ id: decorationId, patch: { border_geometry: geometry } });
  }

  function handleDecorationChange(decoration: Decoration, geometry: Geometry) {
    if (decoration.id == null) return;
    const decorationId = decoration.id;
    const previousGeometry = decoration.border_geometry;
    applyDecorationGeometry(decorationId, geometry);
    history.push({
      undo: () => applyDecorationGeometry(decorationId, previousGeometry),
      redo: () => applyDecorationGeometry(decorationId, geometry),
    });
  }

  /** Arrow-key nudge for the currently-selected bed - see the "Keyboard
   * shortcuts" backlog item. Applies the same garden-boundary clamp and
   * other-bed-overlap hard constraint `BedNode`'s own drag handling enforces
   * (see geometry.ts's `clampRectPositionToBounds`/`clampPointToBounds`/
   * `rectanglesOverlap`), silently no-op-ing a nudge that would push the bed
   * outside the garden or into another bed rather than partially applying
   * it. Routes through `handleBedChange` so the move is PATCHed and pushed
   * onto the same undo/redo stack a drag would be. */
  function nudgeSelectedBed(dx: number, dy: number) {
    if (!selectedBed || selectedBed.id == null) return;
    const bedId = selectedBed.id;
    const geometry = selectedBed.border_geometry;
    const otherRects = [...bedRectsById.entries()].filter(([id]) => id !== bedId).map(([, rect]) => rect);

    if (geometry.type === "rectangle") {
      let x = geometry.x + dx;
      let y = geometry.y + dy;
      if (gardenBounds) ({ x, y } = clampRectPositionToBounds(x, y, geometry.width, geometry.height, gardenBounds));
      const candidateRect = { x, y, width: geometry.width, height: geometry.height };
      if (otherRects.some((r) => rectanglesOverlap(candidateRect, r))) return;
      handleBedChange(selectedBed, { ...geometry, x, y });
      return;
    }

    let translated = translateGeometry(geometry, dx, dy) as PolygonGeometry;
    if (gardenBounds) {
      translated = { ...translated, points: translated.points.map((p) => clampPointToBounds(p, gardenBounds)) };
    }
    const candidateRect = boundingRect(translated);
    if (otherRects.some((r) => rectanglesOverlap(candidateRect, r))) return;
    handleBedChange(selectedBed, translated);
  }

  /** Applies (and PUTs) the garden's geometry. Reads the *current* cached
   * garden at call time (not a closed-over `garden` from whenever the undo
   * entry was created) so an undo/redo firing after some other, untracked
   * garden edit (e.g. the compass's orientation change) doesn't clobber that
   * later edit by resending a stale snapshot of it - `putGarden` is a full
   * PUT, unlike the PATCH-based bed/planting/equipment mutations. */
  function applyGardenGeometry(geometry: Geometry) {
    const current = queryClient.getQueryData<Garden>(["garden"]);
    if (!current) return;
    queryClient.setQueryData<Garden>(["garden"], { ...current, border_geometry: geometry });
    gardenGeometryMutation.mutate({
      name: current.name,
      climate_zone: current.climate_zone,
      location: current.location,
      orientation_deg: current.orientation_deg,
      notes: current.notes,
      border_geometry: geometry,
    });
  }

  function handleGardenGeometryChange(geometry: Geometry) {
    if (!garden) return;
    const previousGeometry = garden.border_geometry;
    applyGardenGeometry(geometry);
    history.push({
      undo: () => applyGardenGeometry(previousGeometry),
      redo: () => applyGardenGeometry(geometry),
    });
  }

  // Orientation (compass rotation) isn't one of undo/redo's four tracked
  // geometry-mutation sites (bed, garden boundary, planting, equipment) -
  // scoped out deliberately, see the backlog item this was built for.
  function handleGardenOrientationChange(orientationDeg: number) {
    if (!garden) return;
    queryClient.setQueryData<Garden>(["garden"], (old) => (old ? { ...old, orientation_deg: orientationDeg } : old));
    gardenGeometryMutation.mutate({
      name: garden.name,
      climate_zone: garden.climate_zone,
      location: garden.location,
      orientation_deg: orientationDeg,
      notes: garden.notes,
      border_geometry: garden.border_geometry,
    });
  }

  function applyPlantingGeometry(plantingId: number, geometry: Geometry) {
    queryClient.setQueryData<Planting[]>(["plantings"], (old) =>
      old ? old.map((p) => (p.id === plantingId ? { ...p, geometry } : p)) : old,
    );
    plantingUpdateMutation.mutate({ id: plantingId, patch: { geometry } });
  }

  /** Dragging a planting marker - if it's part of a multi-selection with
   * 2+ members (see PlantPlacementLayer's marquee/shift-click selection),
   * every *other* selected planting is translated by the same delta the
   * dragged one moved (see geometry.ts's translateGeometry), and the whole
   * group's move is recorded as a single combined undo/redo entry so one
   * Ctrl+Z reverts the group move together, not one planting at a time. */
  function handlePlantingMove(planting: Planting, geometry: Geometry) {
    if (planting.id == null) return;
    const plantingId = planting.id;
    const previousGeometry = planting.geometry;

    if (selectedPlantingIds.size <= 1 || !selectedPlantingIds.has(plantingId)) {
      applyPlantingGeometry(plantingId, geometry);
      history.push({
        undo: () => applyPlantingGeometry(plantingId, previousGeometry),
        redo: () => applyPlantingGeometry(plantingId, geometry),
      });
      return;
    }

    const oldRect = boundingRect(previousGeometry);
    const newRect = boundingRect(geometry);
    const dx = newRect.x - oldRect.x;
    const dy = newRect.y - oldRect.y;

    const changes: { id: number; previous: Geometry; next: Geometry }[] = [
      { id: plantingId, previous: previousGeometry, next: geometry },
    ];
    for (const otherId of selectedPlantingIds) {
      if (otherId === plantingId) continue;
      const other = plantings.find((p) => p.id === otherId);
      if (!other) continue;
      changes.push({ id: otherId, previous: other.geometry, next: translateGeometry(other.geometry, dx, dy) });
    }

    for (const change of changes) applyPlantingGeometry(change.id, change.next);
    history.push({
      undo: () => {
        for (const change of changes) applyPlantingGeometry(change.id, change.previous);
      },
      redo: () => {
        for (const change of changes) applyPlantingGeometry(change.id, change.next);
      },
    });
  }

  /** Arrow-key nudge for the currently-selected planting(s) (single select
   * or the multi-selection) - see the "Keyboard shortcuts" backlog item.
   * Mirrors `handlePlantingMove`'s group-translate-by-delta approach for a
   * multi-selection, but the delta here comes directly from the keypress
   * rather than being derived from a drag's old/new geometry. */
  function nudgeSelectedPlantings(dx: number, dy: number) {
    const ids = selectedPlantingIds.size > 0 ? [...selectedPlantingIds] : selectedPlantingId != null ? [selectedPlantingId] : [];
    const changes = ids
      .map((id) => plantings.find((p) => p.id === id))
      .filter((p): p is Planting => p != null && p.id != null)
      .map((p) => ({ id: p.id as number, previous: p.geometry, next: translateGeometry(p.geometry, dx, dy) }));
    if (changes.length === 0) return;
    for (const change of changes) applyPlantingGeometry(change.id, change.next);
    history.push({
      undo: () => {
        for (const change of changes) applyPlantingGeometry(change.id, change.previous);
      },
      redo: () => {
        for (const change of changes) applyPlantingGeometry(change.id, change.next);
      },
    });
  }

  /** Plain click on a marker opens the single-planting edit panel (clearing
   * any active multi-selection first); shift-click toggles that marker's
   * membership in the multi-selection instead (closing the single-edit
   * panel, since only one of the two panels shows at a time - see the JSX
   * below). */
  function handlePlantingSelect(planting: Planting, additive: boolean) {
    if (planting.id == null) return;
    const plantingId = planting.id;
    if (additive) {
      setSelectedPlantingId(null);
      setSelectedPlantingIds((prev) => {
        const next = new Set(prev);
        if (next.has(plantingId)) next.delete(plantingId);
        else next.add(plantingId);
        return next;
      });
      return;
    }
    setSelectedPlantingIds(new Set());
    setSelectedPlantingId(plantingId);
  }

  /** A completed marquee drag (see PlantPlacementLayer) - `additive` mirrors
   * whether shift was held when the drag started: adds the hit plantings to
   * the existing selection, or replaces it outright (including replacing
   * with an empty set for a same-point/empty drag - "click empty space to
   * clear the selection"). */
  function handleMarqueeSelect(ids: number[], additive: boolean) {
    setSelectedPlantingId(null);
    setSelectedPlantingIds((prev) => {
      if (!additive) return new Set(ids);
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function applyEquipmentPatch(equipmentId: number, patch: BedEquipmentUpdate) {
    queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) =>
      old ? old.map((e) => (e.id === equipmentId ? { ...e, ...patch } : e)) : old,
    );
    equipmentGeometryMutation.mutate({ id: equipmentId, patch });
  }

  /** An item's real footprint at placement time (#208): its matching
   * `EquipmentType`'s own `default_geometry` size (a trellis renders wider
   * than a stake, a drip line reads as a thin strip, etc.) instead of the
   * old one-size-fits-all `DEFAULT_EQUIPMENT_SIZE_CM` box - which stays the
   * fallback for an exotic/one-off `equipment_type` with no matching row
   * (`findEquipmentType` returns `undefined` in that case, same "still
   * works, just without a rendered default" contract the backend model
   * itself documents). `default_height_cm` only fills in `height_cm` when
   * the item doesn't already have one - never overwrites a value the user
   * explicitly entered in the inventory form. */
  function equipmentPlacementPatch(item: BedEquipment): { width: number; height: number; height_cm?: number } {
    const matchedType = findEquipmentType(item.equipment_type, equipmentTypes);
    const size = matchedType
      ? boundingRect(matchedType.default_geometry)
      : { width: DEFAULT_EQUIPMENT_SIZE_CM, height: DEFAULT_EQUIPMENT_SIZE_CM };
    const heightPatch =
      item.height_cm == null && matchedType?.default_height_cm != null
        ? { height_cm: matchedType.default_height_cm }
        : {};
    return { width: size.width, height: size.height, ...heightPatch };
  }

  /** Placing an inventory item onto a bed - same cascading default position
   * as the old inline handler this replaced (AddBedForm's nextBedPosition
   * follows the same idea), just lifted up here so it's one of undo/redo's
   * four tracked geometry-mutation sites. */
  function handleEquipmentPlace(item: BedEquipment, bed: Bed) {
    if (item.id == null || bed.id == null) return;
    const itemId = item.id;
    const { width, height, height_cm } = equipmentPlacementPatch(item);
    const existingInBed = equipmentList.filter((e) => e.bed_id === bed.id).length;
    const offset = (existingInBed % 5) * (Math.max(width, height) + 5);
    const previousPatch: BedEquipmentUpdate = {
      bed_id: item.bed_id,
      garden_id: item.garden_id,
      geometry: item.geometry,
    };
    const nextPatch: BedEquipmentUpdate = {
      bed_id: bed.id,
      garden_id: null,
      geometry: { type: "rectangle", x: 10 + offset, y: 10 + offset, width, height, rotation: 0 },
      ...(height_cm != null ? { height_cm } : {}),
    };
    applyEquipmentPatch(itemId, nextPatch);
    history.push({
      undo: () => applyEquipmentPatch(itemId, previousPatch),
      redo: () => applyEquipmentPatch(itemId, nextPatch),
    });
  }

  /** Placing an inventory item directly against the garden as a whole
   * (#207/#208) - a rain barrel, pathway, or other item that doesn't belong
   * to any one bed. Mirrors `handleEquipmentPlace`'s cascading-position/
   * default-size/undo-redo shape exactly, just keyed off `garden_id`
   * instead of `bed_id`; geometry is garden-local the same way a bed's own
   * plantings are bed-local (see `EquipmentLayer.tsx`'s matching render-
   * offset), not literal world coordinates. */
  function handleEquipmentPlaceInGarden(item: BedEquipment) {
    if (item.id == null || garden == null || garden.id == null) return;
    const itemId = item.id;
    const gardenId = garden.id;
    const { width, height, height_cm } = equipmentPlacementPatch(item);
    const existingInGarden = equipmentList.filter((e) => e.garden_id === gardenId).length;
    const offset = (existingInGarden % 5) * (Math.max(width, height) + 5);
    const previousPatch: BedEquipmentUpdate = {
      bed_id: item.bed_id,
      garden_id: item.garden_id,
      geometry: item.geometry,
    };
    const nextPatch: BedEquipmentUpdate = {
      bed_id: null,
      garden_id: gardenId,
      geometry: { type: "rectangle", x: 10 + offset, y: 10 + offset, width, height, rotation: 0 },
      ...(height_cm != null ? { height_cm } : {}),
    };
    applyEquipmentPatch(itemId, nextPatch);
    history.push({
      undo: () => applyEquipmentPatch(itemId, previousPatch),
      redo: () => applyEquipmentPatch(itemId, nextPatch),
    });
  }

  /** "Quick add" (#242) - `QuickAddEquipment` already created `item` as a
   * plain unplaced inventory row (bed_id/garden_id both null, same as
   * `EquipmentPanel`'s own inventory form creates); this adds it to the
   * `bed-equipment` query cache first (mirroring `EquipmentPanel`'s own
   * `createMutation.onSuccess`) so `handleEquipmentPlaceInGarden`'s own
   * `applyEquipmentPatch` - which only ever *updates* an existing cache
   * entry by id, never inserts one - can actually find it, then runs that
   * exact same placement logic. One click, two already-shipped operations
   * composed together - see that component's own doc. */
  function handleQuickAddEquipmentCreated(item: BedEquipment) {
    queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) => (old ? [...old, item] : [item]));
    handleEquipmentPlaceInGarden(item);
  }

  function handleEquipmentReturnToInventory(item: BedEquipment) {
    if (item.id == null) return;
    const itemId = item.id;
    const previousPatch: BedEquipmentUpdate = {
      bed_id: item.bed_id,
      garden_id: item.garden_id,
      geometry: item.geometry,
    };
    const nextPatch: BedEquipmentUpdate = { bed_id: null, garden_id: null, geometry: null };
    applyEquipmentPatch(itemId, nextPatch);
    history.push({
      undo: () => applyEquipmentPatch(itemId, previousPatch),
      redo: () => applyEquipmentPatch(itemId, nextPatch),
    });
  }

  function handleModeChange(next: ViewMode) {
    if (next === "example") {
      setSelectedId(null);
      setSelectedDecorationId(null);
      setSelectedBedIds(new Set());
      setSelectedPlantingIds(new Set());
    }
    setMode(next);
  }

  // Global keyboard shortcuts - only active in "mine" mode, matching the
  // four tracked undo/redo mutation sites which only exist there (the View
  // tab's snapshot stays read-only regardless of which date it's scrubbed
  // to - see #180). Ignores every shortcut below while focus
  // is in a text input/textarea/contenteditable so none of them fight the
  // browser's/field's own native key handling.
  //
  // - Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z (and the Windows-conventional
  //   Ctrl+Y) = redo.
  // - Arrow keys nudge the currently-selected bed (planters tab) or
  //   planting/multi-selection (plants tab) by NUDGE_STEP_CM, or the
  //   coarser DRAG_SNAP_CM with Shift held - see nudgeSelectedBed/
  //   nudgeSelectedPlantings above.
  // - Delete/Backspace opens the same delete-confirm dialog the currently-
  //   open panel's own trash button does (via the panels' requestDelete
  //   imperative handles).
  // - Escape clears the armed plant first if one is armed, else clears
  //   whichever tab's own selection is currently active. Equipment/garden
  //   tabs are deliberately out of scope - neither has a per-item
  //   selection/delete concept the way planters/plants do.
  const { undo: historyUndo, redo: historyRedo } = history;
  // nudgeSelectedBed/nudgeSelectedPlantings close over selectedBed/
  // bedRectsById/gardenBounds/plantings, all recreated every render, so - to
  // avoid re-subscribing the window listener on every render just to keep a
  // fresh closure (the same "wrap in useCallback" fix isn't practical here,
  // since it'd cascade into memoizing handleBedChange/applyPlantingGeometry/
  // history too) - stash the latest closure in a ref and call through it
  // instead of listing the functions themselves in the effect's deps below.
  const nudgeSelectedBedRef = useRef(nudgeSelectedBed);
  nudgeSelectedBedRef.current = nudgeSelectedBed;
  const nudgeSelectedPlantingsRef = useRef(nudgeSelectedPlantings);
  nudgeSelectedPlantingsRef.current = nudgeSelectedPlantings;
  useEffect(() => {
    if (mode !== "mine") return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          if (e.shiftKey) historyRedo();
          else historyUndo();
        } else if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          historyRedo();
        }
        return;
      }

      if (e.key === "Escape") {
        if (armedPlant) {
          setArmedPlant(null);
        } else if (tab === "planters") {
          setSelectedId(null);
          setSelectedDecorationId(null);
          setSelectedBedIds(new Set());
        } else if (tab === "plants") {
          setSelectedPlantingId(null);
          setSelectedPlantingIds(new Set());
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (tab === "planters" && selectedId != null) {
          e.preventDefault();
          bedPanelRef.current?.requestDelete();
        } else if (tab === "planters" && selectedDecorationId != null) {
          e.preventDefault();
          decorationPanelRef.current?.requestDelete();
        } else if (tab === "plants" && selectedPlantingIds.size > 0) {
          e.preventDefault();
          bulkPlantingPanelRef.current?.requestDelete();
        } else if (tab === "plants" && selectedPlantingId != null) {
          e.preventDefault();
          plantingPanelRef.current?.requestDelete();
        }
        return;
      }

      const arrowDeltas: Record<string, { dx: number; dy: number }> = {
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
        ArrowLeft: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 },
      };
      const delta = arrowDeltas[e.key];
      if (!delta) return;
      const step = e.shiftKey ? DRAG_SNAP_CM : NUDGE_STEP_CM;
      if (tab === "planters" && selectedId != null) {
        e.preventDefault();
        nudgeSelectedBedRef.current(delta.dx * step, delta.dy * step);
      } else if (tab === "plants" && (selectedPlantingId != null || selectedPlantingIds.size > 0)) {
        e.preventDefault();
        nudgeSelectedPlantingsRef.current(delta.dx * step, delta.dy * step);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, tab, armedPlant, selectedId, selectedDecorationId, selectedPlantingId, selectedPlantingIds, historyUndo, historyRedo]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
      <Toolbar
        mode={mode}
        onModeChange={handleModeChange}
        tab={tab}
        onTabChange={switchTab}
        zoomPercent={viewport.scale * 100}
        onFitView={handleFitView}
        objectsToolbar={
          <>
            <AddBedForm
              onCreated={(bed) => {
                setSelectedDecorationId(null);
                setSelectedId(bed.id ?? null);
              }}
              nextPosition={nextObjectPosition(beds.length)}
            />
            <AddCompostBinForm
              onCreated={(bed) => {
                setSelectedDecorationId(null);
                setSelectedId(bed.id ?? null);
              }}
              nextPosition={nextObjectPosition(beds.length)}
            />
            <AddDecorationForm
              onCreated={(decoration) => {
                setSelectedId(null);
                setSelectedDecorationId(decoration.id ?? null);
              }}
              nextPosition={nextObjectPosition(decorations.length)}
            />
            {/* #229: soil rotation is bed-level bookkeeping, same tab beds
                themselves are created/managed in - not plant- or
                equipment-scoped. Predates #242's objectsToolbar
                composition (this ticket's own design spec still describes
                the older single addBedForm slot it replaced) - added
                directly into that same composed fragment rather than
                reintroducing a parallel single-purpose Toolbar prop. */}
            <SoilRotationDialog beds={beds} />
          </>
        }
        pipeNetworkTrigger={<PipeNetworkDialog />}
        equipmentQuickAdd={
          <QuickAddEquipment equipmentTypes={equipmentTypes} disabled={!garden} onCreated={handleQuickAddEquipmentCreated} />
        }
        armedPlant={armedPlant}
        onClearArmedPlant={() => setArmedPlant(null)}
        plantPicker={
          <PlantPicker
            plants={plantsQuery.data ?? []}
            armedPlant={armedPlant}
            onPick={(slug) => setArmedPlant(plantsBySlug.get(slug) ?? null)}
          />
        }
        placementMode={placementMode}
        onPlacementModeChange={setPlacementMode}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        viewAsOfDate={viewAsOfDate}
        onViewAsOfDateChange={setViewAsOfDate}
        viewDateRange={viewDateRange}
      />
      <p className="text-xs text-muted-foreground">
        Scroll to pan, Ctrl/Cmd+scroll to zoom, middle-click drag to pan, left-click drag on empty canvas to
        select.
      </p>

      {mode === "mine" && (
        <>
          {isPending && <p className="text-sm text-muted-foreground">Loading beds…</p>}
          {isError && <p className="text-sm text-destructive">Failed to load beds.</p>}
          <OnboardingPrompt
            open={!isPending && !isError && beds.length === 0 && !onboardingDismissed}
            onDismiss={() => setOnboardingDismissed(true)}
            onSeeded={() => {
              setOnboardingDismissed(true);
              queryClient.invalidateQueries({ queryKey: ["beds"] });
              queryClient.invalidateQueries({ queryKey: ["garden"] });
              queryClient.invalidateQueries({ queryKey: ["plantings"] });
              queryClient.invalidateQueries({ queryKey: ["bed-equipment"] });
            }}
          />
          {tab === "plants" && (
            <p className="text-xs text-muted-foreground">
              {armedPlant
                ? placementMode === "individual"
                  ? `Click inside any bed to place ${armedPlant.common_name}.`
                  : `Drag inside any bed to draw where the ${armedPlant.common_name} ${
                      placementMode === "row" ? "row" : "area"
                    } goes.`
                : "Pick a plant above, then draw where it goes: click for a single plant, drag for a row or area."}{" "}
              Click a placed plant to edit or remove it, drag it to move it. With no plant picked, shift-click or drag
              a selection box over multiple plants to select them together for a bulk move or delete.
            </p>
          )}
        </>
      )}
      {mode === "example" && (
        <>
          {(isPending || plantingsQuery.isPending || plantsQuery.isPending) && (
            <p className="text-sm text-muted-foreground">Loading your garden…</p>
          )}
          {(isError || plantingsQuery.isError || plantsQuery.isError) && (
            <p className="text-sm text-destructive">Failed to load your garden.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Read-only snapshot of your real garden as of {viewAsOfDate}{viewAsOfDate === today ? " (today)" : ""} -
            drag the date scrubber above to see what was (or will be) in the ground on another date. Hover a plant
            for its name.
          </p>
        </>
      )}

      {mode === "mine" && data && (
        <div className="flex min-h-0 flex-1 items-stretch gap-4">
          <div ref={canvasContainerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border">
            <Stage
              width={canvasSize.width}
              height={canvasSize.height}
              x={viewport.x}
              y={viewport.y}
              scaleX={viewport.scale}
              scaleY={viewport.scale}
              onWheel={handleWheel}
              onMouseDown={handleMineStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
            >
              <Layer listening={false}>
                <GridLines canvasSize={canvasSize} viewport={viewport} />
              </Layer>
              <Layer>
                {garden && (
                  <GardenBoundary
                    name={garden.name}
                    geometry={garden.border_geometry}
                    isSelected={tab === "garden"}
                    onSelect={() => setSelectedId(null)}
                    onChange={handleGardenGeometryChange}
                    interactive={tab === "garden"}
                    viewport={viewport}
                    onHoverLabel={setTooltip}
                  />
                )}
                {garden && gardenBounds && (
                  <CompassWidget
                    center={compassCenter(gardenBounds)}
                    orientationDeg={garden.orientation_deg}
                    onChange={handleGardenOrientationChange}
                    interactive={tab === "garden"}
                    viewport={viewport}
                  />
                )}
                {beds.map((bed) => (
                  <BedNode
                    key={bed.id}
                    bed={bed}
                    isSelected={
                      tab === "planters" && (bed.id === selectedId || (bed.id != null && selectedBedIds.has(bed.id)))
                    }
                    onSelect={() => {
                      setSelectedId(bed.id ?? null);
                      setSelectedDecorationId(null);
                      setSelectedBedIds(new Set());
                    }}
                    onChange={(geometry) => handleBedChange(bed, geometry)}
                    interactive={tab === "planters"}
                    viewport={viewport}
                    bounds={gardenBounds}
                    otherBedRects={[...bedRectsById.entries()].filter(([id]) => id !== bed.id).map(([, rect]) => rect)}
                    onHoverLabel={setTooltip}
                  />
                ))}
                {bedMarquee &&
                  (() => {
                    const rect = normalizedRect(bedMarquee.start, bedMarquee.current);
                    return (
                      <Rect
                        {...rect}
                        fill="#2563eb1a"
                        stroke="#2563eb"
                        strokeWidth={1 / viewport.scale}
                        dash={[4, 4]}
                        listening={false}
                      />
                    );
                  })()}
              </Layer>
              {tab === "planters" && (
                <DecorationLayer
                  decorations={decorations}
                  selectedId={selectedDecorationId}
                  onSelect={(id) => {
                    setSelectedDecorationId(id);
                    setSelectedId(null);
                    setSelectedBedIds(new Set());
                  }}
                  onChange={handleDecorationChange}
                  viewport={viewport}
                  bounds={gardenBounds}
                />
              )}
              {tab === "equipment" && <EquipmentLayer beds={beds} garden={garden} equipment={equipmentList} />}
              {tab === "plants" && (
                <PlantPlacementLayer
                  ref={plantPlacementRef}
                  beds={beds}
                  plantings={editablePlantings}
                  plantsBySlug={plantsBySlug}
                  active
                  armedPlant={armedPlant}
                  placementMode={placementMode}
                  onPlace={handlePlantPlace}
                  onMove={handlePlantingMove}
                  onSelect={handlePlantingSelect}
                  selectedIds={selectedPlantingIds}
                  onMarqueeSelect={handleMarqueeSelect}
                  plantingWarnings={plantingWarnings}
                  plantingGoodCompanions={plantingGoodCompanions}
                  onHoverIndicator={setTooltip}
                  onDrawGeometryChange={handleDrawGeometryChange}
                  removalStateById={removalStateById}
                  startStateById={startStateById}
                />
              )}
              {/* Drawn last (topmost Konva Layer) so opaque bed/garden-boundary
                  fills underneath never cover the ruler's tick marks - see the
                  "Left tick marks disappear" backlog item. `listening={false}`
                  (set inside RulerLayer itself) means it still never intercepts
                  clicks/drags meant for the layers beneath it despite being on
                  top visually. */}
              <RulerLayer canvasSize={canvasSize} viewport={viewport} />
            </Stage>
            <PlantingTooltip tooltip={tooltip} />
            {tab === "plants" && <GrowthHabitLegend />}
          </div>

          {/* Side panels get their own scroll region (`overflow-y-auto`,
              bounded by the row's own height via `h-full`) instead of
              relying on the whole page to scroll when a panel's content
              (e.g. a bed with lots of fields) exceeds the viewport height -
              see the "No scroll bars" backlog item. */}
          {tab === "garden" && (
            <div className="h-full overflow-y-auto">
              <GardenPanel garden={garden} />
            </div>
          )}
          {tab === "planters" && selectedBed && (
            <div className="h-full overflow-y-auto">
              <BedPanel
                ref={bedPanelRef}
                bed={selectedBed}
                gardenOrientationDeg={garden?.orientation_deg}
                plantings={plantings}
                equipment={equipmentList}
                plantsBySlug={plantsBySlug}
                onClose={() => setSelectedId(null)}
                onDeleted={() => setSelectedId(null)}
              />
            </div>
          )}
          {tab === "planters" && !selectedBed && selectedDecoration && (
            <div className="h-full overflow-y-auto">
              <DecorationPanel
                ref={decorationPanelRef}
                decoration={selectedDecoration}
                onClose={() => setSelectedDecorationId(null)}
                onDeleted={() => setSelectedDecorationId(null)}
              />
            </div>
          )}
          {tab === "equipment" && (
            <div className="h-full overflow-y-auto">
              <EquipmentPanel
                beds={beds}
                garden={garden}
                equipment={equipmentList}
                onClose={() => switchTab("planters")}
                onPlace={handleEquipmentPlace}
                onPlaceInGarden={handleEquipmentPlaceInGarden}
                onReturnToInventory={handleEquipmentReturnToInventory}
              />
            </div>
          )}
          {tab === "plants" && selectedPlantingIds.size > 0 && (
            <div className="h-full overflow-y-auto">
              <BulkPlantingPanel
                ref={bulkPlantingPanelRef}
                plantings={plantings.filter((p) => p.id != null && selectedPlantingIds.has(p.id))}
                onClose={() => setSelectedPlantingIds(new Set())}
                onDeleted={() => setSelectedPlantingIds(new Set())}
              />
            </div>
          )}
          {tab === "plants" && selectedPlantingIds.size === 0 && selectedPlanting && (
            <div className="h-full overflow-y-auto">
              <PlantingPanel
                ref={plantingPanelRef}
                planting={selectedPlanting}
                plant={plantsBySlug.get(selectedPlanting.plant_slug)}
                onClose={() => setSelectedPlantingId(null)}
                onDeleted={() => setSelectedPlantingId(null)}
              />
            </div>
          )}
        </div>
      )}

      {mode === "example" && data && (
        <div ref={canvasContainerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border">
          <Stage
            width={canvasSize.width}
            height={canvasSize.height}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            onWheel={handleWheel}
            onMouseDown={handlePanMouseDown}
          >
            <Layer listening={false}>
              <GridLines canvasSize={canvasSize} viewport={viewport} />
            </Layer>
            <GardenSnapshotLayer beds={beds} plantings={viewPlantings} plantsBySlug={plantsBySlug} onHover={setTooltip} viewport={viewport} />
            {/* Topmost layer - see the "mine" Stage's identical comment above. */}
            <RulerLayer canvasSize={canvasSize} viewport={viewport} />
          </Stage>
          <PlantingTooltip tooltip={tooltip} />
          <GrowthHabitLegend />
        </div>
      )}
    </div>
  );
}
