import type Konva from "konva";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, RegularPolygon, Text, Transformer } from "react-konva";
import type { Bed, Geometry, PlacementType, Plant, Planting } from "@/api/client";
import {
  TRANSFORMER_ANCHOR_SIZE_PX,
  TRANSFORMER_ANCHOR_STROKE_WIDTH_PX,
  TRANSFORMER_BORDER_STROKE_WIDTH_PX,
  TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX,
} from "./BedNode";
import type { PlantingTooltipState } from "./PlantingTooltip";
import {
  boundingRect,
  type Bounds,
  clampRectPositionToBounds,
  colorForSlug,
  effectivePlantSpacing,
  fieldGeometryFromDrag,
  fieldMarkerPositions,
  normalizedRect,
  rectanglesOverlap,
  rectRenderProps,
  rowGeometryFromDrag,
  rowMarkerPositions,
  snapToGrid,
} from "./geometry";
import { PlantFootprint, SpreadOutline } from "./PlantFootprint";
import type { PlantingStartVisualState, RemovalVisualState } from "./plantingLifecycle";

/** Minimum row/field width or height (cm) a resize gesture can shrink to -
 * deliberately smaller than `BedNode.tsx`'s `MIN_SIZE_CM` (20): a row's
 * thickness or a field's own edge is legitimately allowed to be narrower
 * than the smallest sensible bed, since it's just a planting boundary, not
 * a physical structure. Purely a "don't collapse to nothing" floor, not a
 * domain-meaningful minimum planting size. */
const MIN_PLANTING_DIMENSION_CM = 5;

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
  /** The id of the single planting whose edit panel (PlantingPanel) is
   * currently open, i.e. `Layout.tsx`'s own `selectedPlantingId` - distinct
   * from `selectedIds` above (the multi-selection set, used only for the
   * blue highlight stroke). A row/field planting matching this id renders
   * with Konva `Transformer` resize/rotate handles on its boundary (#261),
   * matching `BedNode.tsx`'s own single-selection editing; a multi-selected
   * planting doesn't get handles - there's no defined per-item resize UX for
   * a bulk selection yet, only the bulk move/delete `BulkPlantingPanel`
   * already supports. `null` when no single planting is open. */
  editingId: number | null;
  /** Fired when a marquee (click-drag over empty bed space while no plant is
   * armed - see `canSelect` below) completes: every planting in that bed
   * whose bounding box intersects the drawn rectangle, plus whether it
   * should add to the existing selection (drag started with shift held) or
   * replace it outright (plain drag, including an empty/same-point drag -
   * the "click empty space to clear the selection" case). */
  onMarqueeSelect: (ids: number[], additive: boolean) => void;
  /** Placement-warning reasons (rotation conflict, antagonist companion,
   * shade risk - #26/#174), keyed by planting id - a present (non-empty)
   * entry renders a small warning triangle overlaid on that planting's own
   * footprint instead of a blocking popup. Combines both a *speculative*
   * source (live, only while a candidate plant is armed - see Layout.tsx's
   * own `plantingWarnings` doc) and a *committed* source (permanent, from
   * the moment a planting was actually saved) - this component doesn't
   * need to know or care which produced a given entry. Warning always wins
   * over `plantingGoodCompanions` on the same marker - see
   * `PlantingMarker` below. */
  plantingWarnings: Map<number, { reasons: string[] }>;
  /** Good-companion matches (#174), keyed by planting id - a present entry
   * renders a small green checkmark, but only when that same planting has
   * no entry in `plantingWarnings` (bad news shouldn't hide behind a
   * positive icon). Same speculative/committed combination as
   * `plantingWarnings`. */
  plantingGoodCompanions: Map<number, { neighbors: string[] }>;
  /** Hover/leave on a warning triangle or good-companion checkmark -
   * rendered by the caller via the same `PlantingTooltip` component/state
   * this file's own plant-name hover (BedNode.tsx-style) and
   * GardenSnapshotView's planting-marker hover already reuse, rather than a
   * new tooltip primitive. */
  onHoverIndicator: (tooltip: PlantingTooltipState | null) => void;
  /** Fired continuously while a row/field placement is being drawn
   * (individual/point placements have no pre-click drag phase, so this
   * never fires for those - see #174's design spec) with the *live* preview
   * rectangle - Layout.tsx debounces this into a re-run of the placement
   * check against the live drag position, refining the arm-time
   * bed-centroid approximation the moment the user starts actually drawing.
   * Omitted/no-op is fine; it's a pure refinement, not load-bearing for
   * correctness (the commit-time check is always the authoritative one). */
  onDrawGeometryChange?: (bedId: number, geometry: Geometry) => void;
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
  /** Starts a garden-space marquee-select drag from a mousedown that landed
   * on true empty canvas (outside every bed) - Layout.tsx's
   * `handleMineStageMouseDown` calls this on the Plants tab the same way it
   * already calls `setBedMarquee` on the Planters tab, treating every bed as
   * static background for this gesture rather than requiring the drag to
   * start inside one (#19's third round). No-op while a plant is armed
   * (`canSelect` below) - a click-drag with a plant armed is a draw
   * gesture, not a selection one, and draw gestures always start inside a
   * bed's own shape (nothing to place on empty canvas). */
  handleStageMouseDown: (worldPos: { x: number; y: number }, additive: boolean) => void;
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
    editingId,
    onMarqueeSelect,
    plantingWarnings,
    plantingGoodCompanions,
    onHoverIndicator,
    onDrawGeometryChange,
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
  // Placement (drawing where a plant goes) always happens inside exactly one
  // bed, so `draw` keeps this bed-local shape.
  const [draw, setDraw] = useState<{ bedId: number; start: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null,
  );
  // Selection, unlike placement, treats every bed as static background
  // (#19's third round) - a marquee can start on empty garden canvas, cross
  // multiple beds, and select plantings from all of them. `start`/`current`
  // are therefore tracked directly in Stage-local/world (garden-space cm)
  // coordinates rather than any one bed's local frame - no `bedId` at all.
  const [marquee, setMarquee] = useState<
    { start: { x: number; y: number }; current: { x: number; y: number }; additive: boolean } | null
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
  const thicknessCm = effectivePlantSpacing(null, armedPlant ?? undefined);

  // See PlantPlacementLayerProps.onDrawGeometryChange's own doc - fires on
  // every tick of an in-progress row/field drag with the live preview
  // rectangle so Layout.tsx can refine its arm-time bed-centroid placement
  // check against the actual position being drawn.
  useEffect(() => {
    if (!draw || !onDrawGeometryChange || placementMode === "individual") return;
    const geometry =
      placementMode === "row" ? rowGeometryFromDrag(draw.start, draw.current, thicknessCm) : fieldGeometryFromDrag(draw.start, draw.current);
    if (geometry) onDrawGeometryChange(draw.bedId, geometry);
  }, [draw, placementMode, thicknessCm, onDrawGeometryChange]);

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
    if (canDraw) {
      if (placementMode === "individual") return;
      const pos = localPoint(e);
      if (!pos) return;
      setDraw({ bedId, start: pos, current: pos });
      return;
    }
    if (canSelect) {
      // A marquee starting on a bed's own shape is just the common case of
      // the same garden-wide gesture `handleStageMouseDown` (below) starts
      // from empty canvas - tracked in world coords either way, so this
      // reads through the Stage rather than `localPoint`'s bed-local frame.
      const worldPos = e.target.getStage()?.getRelativePointerPosition();
      if (!worldPos) return;
      setMarquee({ start: worldPos, current: worldPos, additive: e.evt.shiftKey });
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
      // Every bed's plantings, converted to world/garden-space coordinates
      // (each planting's own `geometry` is bed-local, matching
      // `bedLocalPoint`'s offset) - not just one bed's, since the marquee
      // itself is now garden-wide (#19's third round).
      const hitIds: number[] = [];
      for (const bed of beds) {
        if (bed.id == null) continue;
        const bedRect = boundingRect(bed.border_geometry);
        const bedPlantings = plantingsByBed.get(bed.id) ?? [];
        for (const planting of bedPlantings) {
          if (planting.id == null) continue;
          const local = boundingRect(planting.geometry);
          const worldRect = { x: local.x + bedRect.x, y: local.y + bedRect.y, width: local.width, height: local.height };
          if (rectanglesOverlap(marqueeRect, worldRect)) hitIds.push(planting.id);
        }
      }
      onMarqueeSelect(hitIds, marquee.additive);
      setMarquee(null);
    },
    [marquee, beds, plantingsByBed, onMarqueeSelect],
  );

  // See PlantPlacementLayerHandle's own doc - Layout.tsx's Stage-level
  // onMouseMove/onMouseUp forward here instead of relying on a per-bed-shape
  // listener, so an in-progress draw/marquee keeps tracking (and stays
  // visible) even once the drag crosses outside the bed it started in.
  useImperativeHandle(
    ref,
    () => ({
      handleStageMouseDown(worldPos, additive) {
        // Mirrors `handleMouseDown`'s own `canSelect` branch above - a plant
        // armed for drawing means empty-canvas clicks aren't a selection
        // gesture at all (and placement never starts outside a bed, so it
        // has no equivalent empty-canvas case to handle here).
        if (!canSelect) return;
        setMarquee({ start: worldPos, current: worldPos, additive });
      },
      handleStageMouseMove(worldPos) {
        if (draw) {
          const pos = bedLocalPoint(draw.bedId, worldPos);
          if (pos) setDraw((prev) => (prev ? { ...prev, current: pos } : prev));
          return;
        }
        if (marquee) {
          setMarquee((prev) => (prev ? { ...prev, current: worldPos } : prev));
        }
      },
      handleStageMouseUp(worldPos) {
        if (draw) {
          completeDraw(bedLocalPoint(draw.bedId, worldPos) ?? draw.current);
          return;
        }
        if (marquee) {
          completeMarquee(worldPos);
        }
      },
    }),
    [draw, marquee, canSelect, bedLocalPoint, completeDraw, completeMarquee],
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

  // Garden-wide (world-space) marquee rectangle - rendered once, as a
  // sibling of the per-bed Groups below rather than inside any one of them,
  // since a Layer's own coordinate space already matches
  // `stage.getRelativePointerPosition()`'s (no per-bed offset needed here,
  // unlike `preview`, which stays bed-local because placement always
  // happens inside exactly one bed - see `marquee`'s own doc above).
  const marqueeRect = marquee ? normalizedRect(marquee.start, marquee.current) : null;

  return (
    <Layer>
      {beds.map((bed) => {
        if (bed.id == null) return null;
        const rect = boundingRect(bed.border_geometry);
        const bedPlantings = plantingsByBed.get(bed.id) ?? [];
        // Bed-local (not world/garden-space) - plantings render inside this
        // bed's own `<Group x={rect.x} y={rect.y}>` below, in the same
        // bed-local frame their own `geometry` is already stored in, so a
        // row/field resize/rotate clamps against `(0, 0)-(rect.width,
        // rect.height)`, not the bed's world position.
        const bedBounds: Bounds = { x: 0, y: 0, width: rect.width, height: rect.height };
        const preview =
          draw && draw.bedId === bed.id
            ? placementMode === "row"
              ? rowGeometryFromDrag(draw.start, draw.current, thicknessCm)
              : fieldGeometryFromDrag(draw.start, draw.current)
            : null;
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
            {/* Every planting's spread-size outline first, then every
                planting's solid marker (see the JSX below) - two separate
                passes over the same `bedPlantings`, not one outline drawn
                per-marker, so a low-opacity outline can never sit on top of
                a neighboring plant's actual marker where footprints
                overlap close together (#173). */}
            {bedPlantings.map((planting) => (
              <SpreadOutline
                key={`spread-${planting.id}`}
                placementType={planting.placement_type}
                geometry={planting.geometry}
                spacingCm={planting.spacing_cm}
                plant={plantsBySlug.get(planting.plant_slug)}
                slug={planting.plant_slug}
              />
            ))}
            {bedPlantings.map((planting) => (
              <PlantingMarker
                key={planting.id}
                planting={planting}
                plant={plantsBySlug.get(planting.plant_slug)}
                active={active}
                selected={planting.id != null && selectedIds.has(planting.id)}
                isEditing={planting.id != null && planting.id === editingId}
                bedBounds={bedBounds}
                onMove={(geometry) => onMove(planting, geometry)}
                onSelect={(additive) => onSelect(planting, additive)}
                registerNode={(node) => registerNode(planting.id, node)}
                onGroupDragStart={(e) => handleGroupDragStart(planting.id, e)}
                onGroupDragMove={(e) => handleGroupDragMove(planting.id, e)}
                onGroupDragEnd={handleGroupDragEnd}
                warnings={planting.id != null ? plantingWarnings.get(planting.id)?.reasons : undefined}
                goodCompanions={planting.id != null ? plantingGoodCompanions.get(planting.id)?.neighbors : undefined}
                onHoverIndicator={onHoverIndicator}
                removalState={(planting.id != null && removalStateById.get(planting.id)) || "normal"}
                startState={(planting.id != null && startStateById.get(planting.id)) || "normal"}
              />
            ))}
          </Group>
        );
      })}
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
    </Layer>
  );
});

// Multi-selection highlight - same blue BedNode/GardenBoundary already use
// for their own single-selection state.
const SELECTION_HIGHLIGHT_COLOR = "#1d4ed8";

// Matches this app's existing warning color language (see
// seed-guide/SeedGuideView.tsx's amber "sow" styling) - Tailwind's
// amber-600. Shared by both indicator icons below (#174) - renamed from
// #26's original WARNING_TRIANGLE_RADIUS_CM now that it sizes the
// checkmark too.
const WARNING_TRIANGLE_COLOR = "#d97706";
// This app's first "positive/success" color (emerald-600) - a reasonable
// candidate to become the standing success color going forward, per #174's
// design spec, given there wasn't one yet.
const COMPANION_CHECKMARK_COLOR = "#059669";
const INDICATOR_ICON_RADIUS_CM = 7;

/** Small filled triangle flagging one or more placement-warning reasons
 * (same-family crop-rotation conflict, antagonist companion, shade risk -
 * #26/#174) - anchored at a marker's own corner, hover-only (no click
 * target of its own, distinct from the marker's click-to-edit/shift-click-
 * to-select interactions) via the shared `PlantingTooltip`. Reason-agnostic:
 * `reasons` is already the exact set of human-readable lines to show,
 * assembled by whoever populates `plantingWarnings` (Layout.tsx). */
function WarningTriangle({
  x,
  y,
  reasons,
  onHover,
}: {
  x: number;
  y: number;
  reasons: string[];
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  function showTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHover({
      x: e.evt.clientX - stageBox.left,
      y: e.evt.clientY - stageBox.top,
      title: "Placement warning",
      subtitle: reasons,
    });
  }

  return (
    <RegularPolygon
      x={x}
      y={y}
      sides={3}
      radius={INDICATOR_ICON_RADIUS_CM}
      fill={WARNING_TRIANGLE_COLOR}
      stroke="#ffffff"
      strokeWidth={1}
      onMouseEnter={showTooltip}
      onMouseMove={showTooltip}
      onMouseLeave={() => onHover(null)}
    />
  );
}

/** Small filled circle + checkmark glyph flagging one or more good-
 * companion matches against an already-placed neighbor (#174) - same
 * anchoring/interaction pattern as `WarningTriangle` above, only ever shown
 * when that same marker has *no* warnings (see `PlantingMarker`'s own
 * priority logic below). */
function CompanionCheckmark({
  x,
  y,
  neighbors,
  onHover,
}: {
  x: number;
  y: number;
  neighbors: string[];
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  function showTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHover({
      x: e.evt.clientX - stageBox.left,
      y: e.evt.clientY - stageBox.top,
      title: "Good companion",
      subtitle: neighbors,
    });
  }

  return (
    <Group x={x} y={y} onMouseEnter={showTooltip} onMouseMove={showTooltip} onMouseLeave={() => onHover(null)}>
      <Circle radius={INDICATOR_ICON_RADIUS_CM} fill={COMPANION_CHECKMARK_COLOR} stroke="#ffffff" strokeWidth={1} />
      <Line
        points={[-3, 0, -1, 2.5, 3, -2.5]}
        stroke="#ffffff"
        strokeWidth={1.5}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    </Group>
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
  isEditing,
  bedBounds,
  onMove,
  onSelect,
  registerNode,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  warnings,
  goodCompanions,
  onHoverIndicator,
  removalState,
  startState,
}: {
  planting: Planting;
  plant: Plant | undefined;
  active: boolean;
  /** Whether this marker is part of the current multi-selection (marquee-
   * drag or shift-click) - see PlantPlacementLayerProps.selectedIds. */
  selected: boolean;
  /** See PlantPlacementLayerProps.editingId - true only for the single
   * planting whose edit panel is open. Row/field placements render
   * Transformer resize/rotate handles on their boundary only while this is
   * true (#261); individual (point) placements ignore it entirely, same as
   * they already ignore `selected`. */
  isEditing: boolean;
  /** This planting's own bed footprint, bed-local (`(0, 0)` to
   * `(width, height)`) - a row/field resize/rotate is clamped to stay
   * within it, mirroring `BedNode.tsx`'s own `bounds` clamp against the
   * garden boundary (#261's "scope question", resolved as: clamp, don't
   * reject). Unused by the individual-placement render path below. */
  bedBounds: Bounds;
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
  /** See PlantPlacementLayerProps.plantingWarnings - undefined/empty means
   * no warning (or none checked yet), in which case no triangle renders. */
  warnings: string[] | undefined;
  /** See PlantPlacementLayerProps.plantingGoodCompanions - only rendered
   * (as a checkmark) when `warnings` above is empty; warning always wins on
   * the same marker. */
  goodCompanions: string[] | undefined;
  onHoverIndicator: (tooltip: PlantingTooltipState | null) => void;
  /** See PlantPlacementLayerProps.removalStateById - "normal" for a planting
   * with no removed_date scheduled at all. */
  removalState: RemovalVisualState;
  /** See PlantPlacementLayerProps.startStateById - "normal" for a planting
   * with no planted_date, or one already on/before today. */
  startState: PlantingStartVisualState;
}) {
  const label = plant?.common_name ?? planting.plant_slug;
  const color = colorForSlug(planting.plant_slug);

  // Row/field boundary-editing wiring (#261) - hooks must run unconditionally
  // every render (rules of hooks), so these live here rather than inside the
  // `if` branch below even though only that branch (and none of the
  // individual-placement path further down) ever binds/reads them.
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  // The in-progress resize/rotate geometry, tracked in React state (rather
  // than an imperative ref like BedNode.tsx's own live-dimension-label
  // pattern) specifically so it drives a full re-render of `markerPositions`
  // below - a resize can change how many markers a row/field fits at its own
  // `effectiveSpacing`, not just where they sit, which an imperative
  // fixed-length node-reposition (the group-drag-follow pattern used
  // elsewhere in this file) can't express. `null` outside of an active
  // transform gesture, in which case rendering falls back to the committed
  // `planting.geometry`.
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; width: number; height: number; rotation: number } | null>(null);

  useEffect(() => {
    if (active && isEditing && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [active, isEditing]);

  if (planting.placement_type === "row" || planting.placement_type === "field") {
    const props = rectRenderProps(planting.geometry);
    // The plant's own default spacing, overridable per-placement (#154's
    // `spacing_cm`, edited in PlantingPanel.tsx) - matches the same
    // fallback `PlantPlacementLayer`'s own draw-time `thicknessCm` uses.
    const effectiveSpacing = effectivePlantSpacing(planting.spacing_cm, plant);
    const markerRadius = Math.max(3, effectiveSpacing / 2);
    // Live geometry while a resize/rotate gesture is in progress, falling
    // back to the committed geometry the rest of the time - see `liveRect`'s
    // own doc above.
    const renderRect = liveRect ?? props;
    // The drawn rectangle is only ever the placement's own drag/select/
    // delete hit-target (see this branch's `Rect` below) - what actually
    // reads as "the plants" is this grid/line of individual markers filling
    // it at `effectiveSpacing` (#155), not the rectangle itself.
    const markerPositions =
      planting.placement_type === "row"
        ? rowMarkerPositions(renderRect, effectiveSpacing)
        : fieldMarkerPositions(renderRect, effectiveSpacing);
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

    /** Fires on every tick of a resize/rotate gesture (Konva's `Transformer`
     * scales the underlying node's `scaleX`/`scaleY` live rather than
     * changing `width`/`height` directly) - mirrors `BedNode.tsx`'s own
     * onTransform reading, just driving `liveRect` React state instead of an
     * imperative dimension-label update, per `liveRect`'s own doc above. */
    function handleTransform() {
      const node = shapeRef.current;
      if (!node) return;
      setLiveRect({
        x: node.x(),
        y: node.y(),
        width: node.width() * node.scaleX(),
        height: node.height() * node.scaleY(),
        rotation: node.rotation(),
      });
    }

    /** Commits a finished resize/rotate gesture - grid-snaps the result
     * (matching `handleDragEnd`'s own snapping) and clamps it to stay within
     * this planting's own bed (`bedBounds`), the same *clamp, don't reject*
     * treatment `BedNode.tsx` gives a bed against the garden boundary
     * (#261's "scope question"). */
    function handleTransformEnd() {
      const node = shapeRef.current;
      if (!node) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      // Konva's Transformer expresses a resize as node scale, not a changed
      // width/height - reset back to 1 once the real width/height below is
      // derived from it, same as BedNode.tsx's identical onTransformEnd.
      node.scaleX(1);
      node.scaleY(1);
      let width = Math.max(MIN_PLANTING_DIMENSION_CM, snapToGrid(Math.round(node.width() * scaleX)));
      let height = Math.max(MIN_PLANTING_DIMENSION_CM, snapToGrid(Math.round(node.height() * scaleY)));
      width = Math.min(width, Math.max(MIN_PLANTING_DIMENSION_CM, bedBounds.width));
      height = Math.min(height, Math.max(MIN_PLANTING_DIMENSION_CM, bedBounds.height));
      const { x, y } = clampRectPositionToBounds(snapToGrid(node.x()), snapToGrid(node.y()), width, height, bedBounds);
      setLiveRect(null);
      onMove({ type: "rectangle", x, y, width, height, rotation: node.rotation() });
    }

    return (
      <>
        <Rect
          ref={(node) => {
            registerNode(node);
            shapeRef.current = node;
          }}
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
          stroke={selected || isEditing ? SELECTION_HIGHLIGHT_COLOR : color}
          strokeWidth={selected || isEditing ? 3 : 1.5}
          dash={markerVisual.dash}
          draggable={active}
          listening={active}
          onDragStart={onGroupDragStart}
          onDragMove={onGroupDragMove}
          onDragEnd={handleDragEnd}
          onClick={(e) => onSelect(e.evt.shiftKey)}
          onTap={() => onSelect(false)}
          onTransform={handleTransform}
          onTransformEnd={handleTransformEnd}
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
        {warnings && warnings.length > 0 ? (
          <WarningTriangle x={props.x + props.width} y={props.y} reasons={warnings} onHover={onHoverIndicator} />
        ) : (
          goodCompanions &&
          goodCompanions.length > 0 && (
            <CompanionCheckmark x={props.x + props.width} y={props.y} neighbors={goodCompanions} onHover={onHoverIndicator} />
          )
        )}
        {isEditing && active && (
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={false}
            anchorSize={TRANSFORMER_ANCHOR_SIZE_PX}
            anchorStrokeWidth={TRANSFORMER_ANCHOR_STROKE_WIDTH_PX}
            borderStrokeWidth={TRANSFORMER_BORDER_STROKE_WIDTH_PX}
            rotateAnchorOffset={TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < MIN_PLANTING_DIMENSION_CM || newBox.height < MIN_PLANTING_DIMENSION_CM) return oldBox;
              return newBox;
            }}
          />
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
      {warnings && warnings.length > 0 ? (
        <WarningTriangle x={centerX + radius * 0.7} y={centerY - radius * 0.7} reasons={warnings} onHover={onHoverIndicator} />
      ) : (
        goodCompanions &&
        goodCompanions.length > 0 && (
          <CompanionCheckmark
            x={centerX + radius * 0.7}
            y={centerY - radius * 0.7}
            neighbors={goodCompanions}
            onHover={onHoverIndicator}
          />
        )
      )}
    </>
  );
}
