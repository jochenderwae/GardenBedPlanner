import type Konva from "konva";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Group, Layer, Rect, RegularPolygon, Text } from "react-konva";
import type { Bed, Geometry, PlacementType, Plant, Planting, RotationWarning } from "@/api/client";
import type { PlantingTooltipState } from "./PlantingTooltip";
import {
  boundingRect,
  colorForSlug,
  DEFAULT_PLANTING_DIAMETER_CM,
  fieldGeometryFromDrag,
  fieldMarkerPositions,
  normalizedRect,
  rectanglesOverlap,
  rectRenderProps,
  rowGeometryFromDrag,
  rowMarkerPositions,
  snapToGrid,
} from "./geometry";
import { PlantFootprint } from "./PlantFootprint";
import type { PlantingStartVisualState, RemovalVisualState } from "./plantingLifecycle";

/** "individual" draws with a single click; "row"/"field" draw with a
 * click-drag-release gesture (see PlantPlacementLayer's mouse handlers
 * below) - matches `Planting.placement_type` exactly, just named for the
 * drawing gesture it maps to rather than the backend's own vocabulary. */
export type PlacementMode = PlacementType;

interface PlantPlacementLayerProps {
  beds: Bed[];
  plantings: Planting[];
  plantsBySlug: Map<string, Plant>;
  active: boolean;
  /** The plant currently "armed" for placement - drawing on the canvas is a
   * no-op until one is picked (see Layout.tsx's toolbar). */
  armedPlant: Plant | null;
  placementMode: PlacementMode;
  onPlace: (bedId: number, geometry: Geometry, placementType: PlacementType) => void;
  onMove: (planting: Planting, geometry: Geometry) => void;
  /** Plain click on an existing marker opens its edit/details popup
   * (PlantingPanel, owned by Layout.tsx); shift-click (`additive: true`)
   * instead toggles that marker into/out of the multi-selection (see
   * `selectedIds`/`onMarqueeSelect` below) without opening anything - delete
   * lives inside PlantingPanel for a single planting, or BulkPlantingPanel
   * for a multi-selection. */
  onSelect: (planting: Planting, additive: boolean) => void;
  /** Ids of the plantings currently in the multi-selection (marquee-drag or
   * shift-click) - drawn with a highlighted stroke; dragging any one of them
   * while the selection has 2+ members moves the whole group together (see
   * Layout.tsx's handlePlantingMove). */
  selectedIds: Set<number>;
  /** Fired when a marquee (click-drag over empty bed space while no plant is
   * armed - see `canSelect` below) completes: every planting in that bed
   * whose bounding box intersects the drawn rectangle, plus whether it
   * should add to the existing selection (drag started with shift held) or
   * replace it outright (plain drag, including an empty/same-point drag -
   * the "click empty space to clear the selection" case). */
  onMarqueeSelect: (ids: number[], additive: boolean) => void;
  /** Same-family crop-rotation warnings (#26), keyed by planting id - a
   * present entry (always `has_warning: true`, see Layout.tsx's own
   * `rotationWarnings` state doc) renders a small warning triangle
   * overlaid on that planting's own footprint instead of a blocking popup,
   * per #174's interaction design (this is the minimal rotation-only slice
   * of it - #174 itself covers the fuller arm-a-candidate/companion-check
   * version once a UI/UX pass settles the final icon design). */
  rotationWarnings: Map<number, RotationWarning>;
  /** Hover/leave on a warning triangle - rendered by the caller via the
   * same `PlantingTooltip` component/state this file's own plant-name
   * hover (BedNode.tsx-style) and GardenSnapshotView's planting-marker hover
   * already reuse, rather than a new tooltip primitive. */
  onHoverWarning: (tooltip: PlantingTooltipState | null) => void;
  /** Edit-tab-only visual state (#180) derived from each planting's own
   * `removed_date` vs. today - dashed stroke for a future-dated removal,
   * further-reduced opacity once it's within `LEAVING_SOON_THRESHOLD_DAYS`.
   * Keyed by planting id; a missing entry (or the planting itself having no
   * id yet) renders as "normal". */
  removalStateById: Map<number, RemovalVisualState>;
  /** Edit-tab-only visual state (#201) derived from each planting's own
   * `planted_date` vs. today - the "not yet in the ground" mirror of
   * `removalStateById` above, using a visually distinct dash pattern so the
   * two provisional states (not-yet-planted vs. leaving-soon) read as
   * different things, not the same cue with two meanings. Takes priority
   * over `removalStateById` when both are non-"normal" (see
   * `combinedVisualProps` below) - a planting that hasn't started yet reads
   * as "not yet planted" regardless of any (nonsensical, but not
   * data-impossible) future removal also being scheduled on it. */
  startStateById: Map<number, PlantingStartVisualState>;
}

/** Imperative escape hatch for Layout.tsx's Stage-level mouse handlers to
 * drive an in-progress draw/marquee drag - see the big comment on `draw`/
 * `marquee` state below for why this exists (a plain per-bed-shape
 * mousemove/mouseup, the previous approach, stops firing the instant the
 * pointer leaves the bed it started in, which is exactly what made the
 * marquee/row/field drag preview freeze or vanish mid-gesture - #19). */
export interface PlantPlacementLayerHandle {
  /** `worldPos` is Stage-local (garden-space cm) - whatever
   * `stage.getRelativePointerPosition()` returns, same coordinate space
   * Layout.tsx's own `bedMarquee` already uses. No-op unless a draw/marquee
   * gesture is actually in progress. */
  handleStageMouseMove: (worldPos: { x: number; y: number }) => void;
  /** Same rationale, for the Stage's own mouseup - completes whichever
   * gesture (draw or marquee) is in progress, if any. */
  handleStageMouseUp: (worldPos: { x: number; y: number }) => void;
}

/** Pick a plant first (Layout.tsx's toolbar), then draw where it goes:
 * single-click for a point placement, click-drag-release for a row (thin
 * rectangle along the drag line) or a field/area (the drawn rectangle
 * itself) - the three `Planting.placement_type` values the backend already
 * supports. Existing plantings render as draggable, click-to-edit markers
 * (matching how clicking a bed opens BedPanel - see `onSelect`), shaped by
 * their own placement type; drawing/dragging/selecting only responds while
 * the Plants tab is active (the `active` prop - see Layout.tsx's tab
 * switcher, the same "locked while on another tab" mechanism used for
 * beds). */
export const PlantPlacementLayer = forwardRef<PlantPlacementLayerHandle, PlantPlacementLayerProps>(function PlantPlacementLayer(
  {
    beds,
    plantings,
    plantsBySlug,
    active,
    armedPlant,
    placementMode,
    onPlace,
    onMove,
    onSelect,
    selectedIds,
    onMarqueeSelect,
    rotationWarnings,
    onHoverWarning,
    removalStateById,
    startStateById,
  },
  ref,
) {
  // `start`/`current` are always in the *drag's own bed*'s local
  // coordinates (bed-group-relative, matching `boundingRect(bed.geometry)`'s
  // offset) - `bedId` is captured once at mousedown (see handleMouseDown,
  // still per-bed-shape: hit-testing *which* bed a gesture starts in is
  // exactly what a per-shape listener is reliable for) so later
  // Stage-forwarded updates know which bed's offset to convert through.
  const [draw, setDraw] = useState<{ bedId: number; start: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null,
  );
  const [marquee, setMarquee] = useState<
    { bedId: number; start: { x: number; y: number }; current: { x: number; y: number }; additive: boolean } | null
  >(null);

  // Konva node registry (planting id -> its live Rect/PlantFootprint node),
  // used only for the multi-select group-drag-follow effect below - lets
  // `handleGroupDragMove` imperatively reposition every *other* selected
  // marker's node while one of them is being natively dragged, the same
  // per-tick-ref-update-without-a-React-render pattern BedNode.tsx's own
  // dimension-label-follow already uses.
  const nodeRefs = useRef<Map<number, Konva.Node>>(new Map());
  const dragGroupRef = useRef<{
    draggedId: number;
    startX: number;
    startY: number;
    startPositions: Map<number, { x: number; y: number }>;
  } | null>(null);

  const plantingsByBed = useMemo(() => {
    const map = new Map<number, Planting[]>();
    for (const planting of plantings) {
      const list = map.get(planting.bed_id) ?? [];
      list.push(planting);
      map.set(planting.bed_id, list);
    }
    return map;
  }, [plantings]);

  const canDraw = active && armedPlant != null;
  // No plant armed = selection mode: click-drag over empty bed space draws a
  // marquee instead of a placement (see handleMouseDown/Up below).
  const canSelect = active && armedPlant == null;
  const thicknessCm = armedPlant?.spread_cm ?? DEFAULT_PLANTING_DIAMETER_CM;

  function localPoint(e: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } | null {
    return e.target.getRelativePointerPosition();
  }

  function handleClick(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (!canDraw || placementMode !== "individual" || !armedPlant) return;
    const pos = localPoint(e);
    if (!pos) return;
    onPlace(
      bedId,
      {
        type: "rectangle",
        x: pos.x - thicknessCm / 2,
        y: pos.y - thicknessCm / 2,
        width: thicknessCm,
        height: thicknessCm,
        rotation: 0,
      },
      "individual",
    );
  }

  function handleMouseDown(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    const pos = localPoint(e);
    if (!pos) return;
    if (canDraw) {
      if (placementMode === "individual") return;
      setDraw({ bedId, start: pos, current: pos });
      return;
    }
    if (canSelect) {
      setMarquee({ bedId, start: pos, current: pos, additive: e.evt.shiftKey });
    }
  }

  /** Converts a Stage-local (world/garden-space cm) point to the given bed's
   * own local coordinates - what `draw`/`marquee.current` are tracked in -
   * by subtracting that bed's own bounding-rect offset. Mirrors what
   * `localPoint`'s `getRelativePointerPosition()` already did implicitly
   * when called on a bed-Group-child shape. */
  const bedLocalPoint = useCallback(
    (bedId: number, worldPos: { x: number; y: number }): { x: number; y: number } | null => {
      const bed = beds.find((b) => b.id === bedId);
      if (!bed) return null;
      const bedRect = boundingRect(bed.border_geometry);
      return { x: worldPos.x - bedRect.x, y: worldPos.y - bedRect.y };
    },
    [beds],
  );

  const completeDraw = useCallback(
    (pos: { x: number; y: number }) => {
      if (!draw) return;
      if (armedPlant) {
        const geometry =
          placementMode === "row"
            ? rowGeometryFromDrag(draw.start, pos, thicknessCm)
            : fieldGeometryFromDrag(draw.start, pos);
        if (geometry) onPlace(draw.bedId, geometry, placementMode);
      }
      setDraw(null);
    },
    [draw, armedPlant, placementMode, thicknessCm, onPlace],
  );

  const completeMarquee = useCallback(
    (pos: { x: number; y: number }) => {
      if (!marquee) return;
      const marqueeRect = normalizedRect(marquee.start, pos);
      const bedPlantings = plantingsByBed.get(marquee.bedId) ?? [];
      const hitIds = bedPlantings
        .filter((p) => p.id != null && rectanglesOverlap(marqueeRect, boundingRect(p.geometry)))
        .map((p) => p.id as number);
      onMarqueeSelect(hitIds, marquee.additive);
      setMarquee(null);
    },
    [marquee, plantingsByBed, onMarqueeSelect],
  );

  // See PlantPlacementLayerHandle's own doc - Layout.tsx's Stage-level
  // onMouseMove/onMouseUp forward here instead of relying on a per-bed-shape
  // listener, so an in-progress draw/marquee keeps tracking (and stays
  // visible) even once the drag crosses outside the bed it started in.
  useImperativeHandle(
    ref,
    () => ({
      handleStageMouseMove(worldPos) {
        if (draw) {
          const pos = bedLocalPoint(draw.bedId, worldPos);
          if (pos) setDraw((prev) => (prev ? { ...prev, current: pos } : prev));
          return;
        }
        if (marquee) {
          const pos = bedLocalPoint(marquee.bedId, worldPos);
          if (pos) setMarquee((prev) => (prev ? { ...prev, current: pos } : prev));
        }
      },
      handleStageMouseUp(worldPos) {
        if (draw) {
          completeDraw(bedLocalPoint(draw.bedId, worldPos) ?? draw.current);
          return;
        }
        if (marquee) {
          completeMarquee(bedLocalPoint(marquee.bedId, worldPos) ?? marquee.current);
        }
      },
    }),
    [draw, marquee, bedLocalPoint, completeDraw, completeMarquee],
  );

  /** Registers (or, called with `null`, deregisters on unmount) a planting
   * marker's live Konva node, keyed by planting id - see `nodeRefs` above. */
  function registerNode(plantingId: number | null | undefined, node: Konva.Node | null) {
    if (plantingId == null) return;
    if (node) nodeRefs.current.set(plantingId, node);
    else nodeRefs.current.delete(plantingId);
  }

  /** Snapshots every *other* selected marker's current on-screen position at
   * the start of a drag gesture - the baseline `handleGroupDragMove` below
   * translates from on every subsequent tick. A no-op (leaves
   * `dragGroupRef` unset) unless this drag is actually part of a 2+-member
   * selection, matching `Layout.tsx`'s `handlePlantingMove`'s own identical
   * threshold for when a drag becomes a group move. */
  function handleGroupDragStart(plantingId: number | null | undefined, e: Konva.KonvaEventObject<DragEvent>) {
    if (plantingId == null || selectedIds.size <= 1 || !selectedIds.has(plantingId)) {
      // Explicitly clear rather than leave whatever a previous gesture left
      // behind - guards against a stale `dragGroupRef` (e.g. an interrupted
      // prior drag that skipped its own onDragEnd) being mistaken for this
      // one if this same planting is ever dragged again later while *not*
      // part of a multi-selection.
      dragGroupRef.current = null;
      return;
    }
    const startPositions = new Map<number, { x: number; y: number }>();
    for (const id of selectedIds) {
      if (id === plantingId) continue;
      const node = nodeRefs.current.get(id);
      if (node) startPositions.set(id, { x: node.x(), y: node.y() });
    }
    dragGroupRef.current = { draggedId: plantingId, startX: e.target.x(), startY: e.target.y(), startPositions };
  }

  /** Live-follow: every other selected marker's Konva node is imperatively
   * repositioned by the same delta the actively-dragged node has moved so
   * far, each frame - purely visual (Konva ref mutation + `batchDraw`, no
   * React state touched), matching BedNode.tsx's own live-dimension-label
   * pattern. The *real* geometry commit for all of them still happens once,
   * on drag-end, via `onMove` -> `Layout.tsx`'s `handlePlantingMove`, which
   * already derives the same delta from before/after geometry and applies
   * it to every selected planting as a single combined undo/redo entry -
   * this only fixes the previously-missing live visual, not the eventual
   * commit logic (already correct). */
  function handleGroupDragMove(plantingId: number | null | undefined, e: Konva.KonvaEventObject<DragEvent>) {
    const group = dragGroupRef.current;
    if (!group || plantingId == null || group.draggedId !== plantingId) return;
    const dx = e.target.x() - group.startX;
    const dy = e.target.y() - group.startY;
    for (const [id, pos] of group.startPositions) {
      nodeRefs.current.get(id)?.position({ x: pos.x + dx, y: pos.y + dy });
    }
    e.target.getLayer()?.batchDraw();
  }

  function handleGroupDragEnd() {
    dragGroupRef.current = null;
  }

  return (
    <Layer>
      {beds.map((bed) => {
        if (bed.id == null) return null;
        const rect = boundingRect(bed.border_geometry);
        const bedPlantings = plantingsByBed.get(bed.id) ?? [];
        const preview =
          draw && draw.bedId === bed.id
            ? placementMode === "row"
              ? rowGeometryFromDrag(draw.start, draw.current, thicknessCm)
              : fieldGeometryFromDrag(draw.start, draw.current)
            : null;
        const marqueeRect = marquee && marquee.bedId === bed.id ? normalizedRect(marquee.start, marquee.current) : null;
        return (
          <Group key={bed.id} x={rect.x} y={rect.y}>
            <Rect
              width={rect.width}
              height={rect.height}
              listening={canDraw || canSelect}
              onClick={(e) => handleClick(bed.id as number, e)}
              onMouseDown={(e) => handleMouseDown(bed.id as number, e)}
            />
            {preview && (
              <Rect
                {...preview}
                fill={colorForSlug(armedPlant?.slug ?? "")}
                opacity={0.35}
                stroke={colorForSlug(armedPlant?.slug ?? "")}
                strokeWidth={1}
                listening={false}
              />
            )}
            {marqueeRect && (
              <Rect
                {...marqueeRect}
                fill="#2563eb1a"
                stroke="#2563eb"
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            )}
            {bedPlantings.map((planting) => (
              <PlantingMarker
                key={planting.id}
                planting={planting}
                plant={plantsBySlug.get(planting.plant_slug)}
                active={active}
                selected={planting.id != null && selectedIds.has(planting.id)}
                onMove={(geometry) => onMove(planting, geometry)}
                onSelect={(additive) => onSelect(planting, additive)}
                registerNode={(node) => registerNode(planting.id, node)}
                onGroupDragStart={(e) => handleGroupDragStart(planting.id, e)}
                onGroupDragMove={(e) => handleGroupDragMove(planting.id, e)}
                onGroupDragEnd={handleGroupDragEnd}
                rotationWarning={planting.id != null ? rotationWarnings.get(planting.id) : undefined}
                onHoverWarning={onHoverWarning}
                removalState={(planting.id != null && removalStateById.get(planting.id)) || "normal"}
                startState={(planting.id != null && startStateById.get(planting.id)) || "normal"}
              />
            ))}
          </Group>
        );
      })}
    </Layer>
  );
});

// Multi-selection highlight - same blue BedNode/GardenBoundary already use
// for their own single-selection state.
const SELECTION_HIGHLIGHT_COLOR = "#1d4ed8";

// Matches this app's existing warning color language (see
// seed-guide/SeedGuideView.tsx's amber "sow" styling) - Tailwind's
// amber-600.
const WARNING_TRIANGLE_COLOR = "#d97706";
const WARNING_TRIANGLE_RADIUS_CM = 7;

/** Small filled triangle flagging a same-family crop-rotation conflict
 * (#26) - anchored at a marker's own corner, hover-only (no click target of
 * its own, distinct from the marker's click-to-edit/shift-click-to-select
 * interactions) via the shared `PlantingTooltip`. Deliberately minimal:
 * #174 owns the fuller warning/good-companion-checkmark icon design once a
 * UI/UX pass settles on it; this is the rotation-only slice #26 itself
 * authorizes ("building the minimal version of it if #174 hasn't landed
 * yet"), not a second indicator system. */
function WarningTriangle({
  x,
  y,
  warning,
  onHover,
}: {
  x: number;
  y: number;
  warning: RotationWarning;
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  function showTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    const conflictName = warning.conflicting_plant_common_name ?? warning.conflicting_plant_slug ?? "a recent planting";
    onHover({
      x: e.evt.clientX - stageBox.left,
      y: e.evt.clientY - stageBox.top,
      title: `Rotation warning: ${warning.family_name ?? "same family"}`,
      subtitle: `Follows ${conflictName} in this bed - same family, disease-carryover risk.`,
    });
  }

  return (
    <RegularPolygon
      x={x}
      y={y}
      sides={3}
      radius={WARNING_TRIANGLE_RADIUS_CM}
      fill={WARNING_TRIANGLE_COLOR}
      stroke="#ffffff"
      strokeWidth={1}
      onMouseEnter={showTooltip}
      onMouseMove={showTooltip}
      onMouseLeave={() => onHover(null)}
    />
  );
}

// Dash pattern for a future-dated removal ("scheduled"/"leaving-soon", see
// plantingLifecycle.ts) - matches the marquee-select rectangle's own
// dash={[4, 4]} elsewhere in this file, this app's existing "provisional"
// visual language.
const REMOVAL_DASH_PATTERN = [4, 4];
// Between the existing 0.85 "normal" marker opacity and the 0.5-0.35
// preview-ghost opacities used elsewhere in this file - reads as "leaving
// soon" without looking like an in-progress drag preview.
const LEAVING_SOON_OPACITY = 0.6;

/** Derives a marker's opacity/dash from its Edit-tab removal state (#180) -
 * `baseOpacity` is whatever the marker would render at with no removal
 * scheduled at all (0.85 for every `PlantFootprint` in this file). */
function removalVisualProps(state: RemovalVisualState, baseOpacity: number): { opacity: number; dash?: number[] } {
  switch (state) {
    case "leaving-soon":
      return { opacity: LEAVING_SOON_OPACITY, dash: REMOVAL_DASH_PATTERN };
    case "scheduled":
      return { opacity: baseOpacity, dash: REMOVAL_DASH_PATTERN };
    default:
      return { opacity: baseOpacity };
  }
}

// Distinct from REMOVAL_DASH_PATTERN (#180's [4, 4]) so "not yet planted"
// and "leaving soon" read as two different provisional states rather than
// the same dashed cue meaning two different things (#201) - a sparser,
// finer dash reads as "doesn't fully exist here yet" vs. the removal
// pattern's more solid dash.
const NOT_YET_PLANTED_DASH_PATTERN = [2, 5];

/** Derives a marker's opacity/dash from its Edit-tab planting-start state
 * (#201) - the "not yet in the ground" mirror of `removalVisualProps`,
 * same tier structure (the further-out state keeps normal opacity with
 * just a dash; the imminent one also dims, reusing `LEAVING_SOON_OPACITY`
 * since the underlying "provisional, about to change" feeling is the same
 * regardless of which direction the change is). */
function startVisualProps(state: PlantingStartVisualState, baseOpacity: number): { opacity: number; dash?: number[] } {
  switch (state) {
    case "starting-soon":
      return { opacity: LEAVING_SOON_OPACITY, dash: NOT_YET_PLANTED_DASH_PATTERN };
    case "not-yet-planted":
      return { opacity: baseOpacity, dash: NOT_YET_PLANTED_DASH_PATTERN };
    default:
      return { opacity: baseOpacity };
  }
}

/** Combines a planting's start-state and removal-state visuals into the
 * one set of props a marker actually renders with - "not yet planted"
 * takes priority over "leaving soon" whenever both are non-"normal" (see
 * `PlantPlacementLayerProps.startStateById`'s own doc for why), otherwise
 * whichever one isn't "normal" wins, and a fully "normal" planting on both
 * axes renders at plain `baseOpacity`. */
function combinedVisualProps(
  startState: PlantingStartVisualState,
  removalState: RemovalVisualState,
  baseOpacity: number,
): { opacity: number; dash?: number[] } {
  if (startState !== "normal") return startVisualProps(startState, baseOpacity);
  return removalVisualProps(removalState, baseOpacity);
}

function PlantingMarker({
  planting,
  plant,
  active,
  selected,
  onMove,
  onSelect,
  registerNode,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  rotationWarning,
  onHoverWarning,
  removalState,
  startState,
}: {
  planting: Planting;
  plant: Plant | undefined;
  active: boolean;
  /** Whether this marker is part of the current multi-selection (marquee-
   * drag or shift-click) - see PlantPlacementLayerProps.selectedIds. */
  selected: boolean;
  onMove: (geometry: Geometry) => void;
  /** `additive` is true for a shift-click (toggle membership in the
   * multi-selection) and false for a plain click (open the single-planting
   * edit panel instead) - see PlantPlacementLayerProps.onSelect. */
  onSelect: (additive: boolean) => void;
  /** See PlantPlacementLayer's `nodeRefs`/`registerNode` - lets a *sibling*
   * marker's drag imperatively reposition this one during a multi-select
   * group drag. */
  registerNode: (node: Konva.Node | null) => void;
  /** See PlantPlacementLayer's `handleGroupDragStart`/`Move`/`End` - wired
   * onto this marker's own drag events so dragging *any* selected marker
   * (not just this one) drives the whole group's live visual follow. */
  onGroupDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onGroupDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onGroupDragEnd: () => void;
  /** See PlantPlacementLayerProps.rotationWarnings - undefined means no
   * conflict (or none checked yet), in which case no triangle renders. */
  rotationWarning: RotationWarning | undefined;
  onHoverWarning: (tooltip: PlantingTooltipState | null) => void;
  /** See PlantPlacementLayerProps.removalStateById - "normal" for a planting
   * with no removed_date scheduled at all. */
  removalState: RemovalVisualState;
  /** See PlantPlacementLayerProps.startStateById - "normal" for a planting
   * with no planted_date, or one already on/before today. */
  startState: PlantingStartVisualState;
}) {
  const label = plant?.common_name ?? planting.plant_slug;
  const color = colorForSlug(planting.plant_slug);

  if (planting.placement_type === "row" || planting.placement_type === "field") {
    const props = rectRenderProps(planting.geometry);
    // The plant's own default spacing, overridable per-placement (#154's
    // `spacing_cm`, edited in PlantingPanel.tsx) - matches the same
    // fallback `PlantPlacementLayer`'s own draw-time `thicknessCm` uses.
    const effectiveSpacing = planting.spacing_cm ?? plant?.spread_cm ?? DEFAULT_PLANTING_DIAMETER_CM;
    const markerRadius = Math.max(3, effectiveSpacing / 2);
    // The drawn rectangle is only ever the placement's own drag/select/
    // delete hit-target (see this branch's `Rect` below) - what actually
    // reads as "the plants" is this grid/line of individual markers filling
    // it at `effectiveSpacing` (#155), not the rectangle itself.
    const markerPositions =
      planting.placement_type === "row" ? rowMarkerPositions(props, effectiveSpacing) : fieldMarkerPositions(props, effectiveSpacing);
    const markerVisual = combinedVisualProps(startState, removalState, 0.85);

    function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
      onGroupDragEnd();
      const node = e.target;
      // Grid-snap the drag's final position - see BedNode.tsx's identical
      // snapToGrid usage; planting drag didn't snap at all before (see the
      // "grid-snap + alignment snapping" backlog item).
      onMove({
        type: "rectangle",
        x: snapToGrid(node.x()),
        y: snapToGrid(node.y()),
        width: props.width,
        height: props.height,
        rotation: node.rotation(),
      });
    }

    return (
      <>
        <Rect
          ref={registerNode}
          x={props.x}
          y={props.y}
          width={props.width}
          height={props.height}
          rotation={props.rotation}
          // Faint fill + a real stroke - this rectangle is only the drawing
          // gesture's own drag/select/delete hit-target now (#155), not the
          // thing meant to read as "the plants" (the individual markers
          // below are).
          fill={color}
          opacity={0.15}
          stroke={selected ? SELECTION_HIGHLIGHT_COLOR : color}
          strokeWidth={selected ? 3 : 1.5}
          dash={markerVisual.dash}
          draggable={active}
          listening={active}
          onDragStart={onGroupDragStart}
          onDragMove={onGroupDragMove}
          onDragEnd={handleDragEnd}
          onClick={(e) => onSelect(e.evt.shiftKey)}
          onTap={() => onSelect(false)}
        />
        {markerPositions.map((pos, i) => (
          <PlantFootprint
            key={i}
            growthHabit={plant?.growth_habit}
            x={pos.x}
            y={pos.y}
            radius={markerRadius}
            fill={color}
            opacity={markerVisual.opacity}
            dash={markerVisual.dash}
            stroke="#00000040"
            strokeWidth={1}
            listening={false}
          />
        ))}
        {active && (
          <Text x={props.x + 4} y={props.y - 14} text={label} fontSize={10} fill="#1f2937" listening={false} />
        )}
        {rotationWarning && (
          <WarningTriangle x={props.x + props.width} y={props.y} warning={rotationWarning} onHover={onHoverWarning} />
        )}
      </>
    );
  }

  const rect = boundingRect(planting.geometry);
  const radius = Math.max(4, rect.width / 2);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const pointVisual = combinedVisualProps(startState, removalState, 0.85);

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    onGroupDragEnd();
    const node = e.target;
    onMove({
      type: "rectangle",
      x: snapToGrid(node.x() - rect.width / 2),
      y: snapToGrid(node.y() - rect.height / 2),
      width: rect.width,
      height: rect.height,
      rotation: 0,
    });
  }

  return (
    <>
      <PlantFootprint
        growthHabit={plant?.growth_habit}
        x={centerX}
        y={centerY}
        radius={radius}
        fill={color}
        opacity={pointVisual.opacity}
        dash={pointVisual.dash}
        stroke={selected ? SELECTION_HIGHLIGHT_COLOR : "#00000040"}
        strokeWidth={selected ? 2.5 : 1}
        draggable={active}
        listening={active}
        nodeRef={registerNode}
        onDragStart={onGroupDragStart}
        onDragMove={onGroupDragMove}
        onDragEnd={handleDragEnd}
        onClick={(e) => onSelect(e.evt.shiftKey)}
        onTap={() => onSelect(false)}
      />
      {active && (
        <Text x={centerX + radius + 3} y={centerY - 5} text={label} fontSize={10} fill="#1f2937" listening={false} />
      )}
      {rotationWarning && (
        <WarningTriangle
          x={centerX + radius * 0.7}
          y={centerY - radius * 0.7}
          warning={rotationWarning}
          onHover={onHoverWarning}
        />
      )}
    </>
  );
}
