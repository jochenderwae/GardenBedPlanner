import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Line, Rect } from "react-konva";
import type Konva from "konva";
import {
  createPlanting,
  getExampleGarden,
  getGarden,
  listBedEquipment,
  listBeds,
  listPlantings,
  listPlants,
  putGarden,
  updateBed,
  updateBedEquipment,
  updatePlanting,
  type Bed,
  type BedEquipment,
  type BedEquipmentUpdate,
  type BedUpdate,
  type Garden,
  type GardenPut,
  type Geometry,
  type PlacementType,
  type Plant,
  type Planting,
  type PlantingUpdate,
  type PolygonGeometry,
} from "@/api/client";
import { BedNode } from "./layout/BedNode";
import { BedPanel, type BedPanelHandle } from "./layout/BedPanel";
import { AddBedForm } from "./layout/AddBedForm";
import { BulkPlantingPanel, type BulkPlantingPanelHandle } from "./layout/BulkPlantingPanel";
import { CompassWidget, COMPASS_MARGIN_CM } from "./layout/CompassWidget";
import { ExampleGardenLayer, PlantingTooltip, type PlantingTooltipState } from "./layout/ExampleGardenView";
import { GardenBoundary } from "./layout/GardenBoundary";
import { GardenPanel } from "./layout/GardenPanel";
import { EquipmentLayer } from "./layout/EquipmentLayer";
import { DEFAULT_EQUIPMENT_SIZE_CM, EquipmentPanel } from "./layout/EquipmentPanel";
import { OnboardingPrompt } from "./layout/OnboardingPrompt";
import { PlantPlacementLayer, type PlacementMode } from "./layout/PlantPlacementLayer";
import { PlantPicker } from "./layout/PlantPicker";
import { PlantingPanel, type PlantingPanelHandle } from "./layout/PlantingPanel";
import { RulerLayer } from "./layout/RulerLayer";
import { Toolbar, type PlacementTab, type ViewMode } from "./layout/Toolbar";
import {
  boundingRect,
  CANVAS_HEIGHT_PX,
  CANVAS_WIDTH_PX,
  clampPointToBounds,
  clampRectPositionToBounds,
  DRAG_SNAP_CM,
  GRID_SPACING_CM,
  normalizedRect,
  NUDGE_STEP_CM,
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

/** Simple cascading placement for a newly-added bed so it doesn't land
 * exactly on top of an existing one - just an starting point, the user
 * drags it wherever it actually belongs. */
function nextBedPosition(beds: Bed[]): { pos_x: number; pos_y: number } {
  const offset = (beds.length % 8) * 30;
  return { pos_x: 20 + offset, pos_y: 20 + offset };
}

export function Layout() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [mode, setMode] = useState<ViewMode>("mine");
  const [tab, setTab] = useState<PlacementTab>("garden");
  // First-run "seed the example garden?" prompt (see OnboardingPrompt.tsx) -
  // dismissing (either "start from scratch" or a successful seed) hides it
  // for the rest of this page load; no persisted flag, so a later reload
  // with beds still empty prompts again (see that component's own doc).
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // "Arm" a plant, then draw where it goes (point/row/area) - see
  // PlantPlacementLayer's own doc. plantPickerOpen/plantPickerPos are for
  // the popover that picks *which* plant gets armed (anchored under the
  // toolbar button below, not tied to a canvas click position the way the
  // old click-first flow's picker was).
  const [armedPlant, setArmedPlant] = useState<Plant | null>(null);
  const [placementMode, setPlacementMode] = useState<PlacementMode>("individual");
  const [plantPickerOpen, setPlantPickerOpen] = useState(false);
  const [plantPickerPos, setPlantPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const plantPickerAnchorRef = useRef<HTMLDivElement>(null);
  // Clicking a placed plant marker opens its edit/details popup
  // (PlantingPanel), matching how clicking a bed opens BedPanel.
  const [selectedPlantingId, setSelectedPlantingId] = useState<number | null>(null);
  // Multi-selection (marquee-drag or shift-click, see PlantPlacementLayer) -
  // separate from the single-select-and-edit `selectedPlantingId` above.
  // Non-empty whenever BulkPlantingPanel is showing instead of PlantingPanel.
  const [selectedPlantingIds, setSelectedPlantingIds] = useState<Set<number>>(new Set());
  const [tooltip, setTooltip] = useState<PlantingTooltipState | null>(null);
  // Imperative handles onto the currently-open panel so the global
  // Delete-key handler below can trigger the exact same confirm-dialog-open
  // action as that panel's own trash button - see the "Keyboard shortcuts"
  // backlog item.
  const bedPanelRef = useRef<BedPanelHandle>(null);
  const plantingPanelRef = useRef<PlantingPanelHandle>(null);
  const bulkPlantingPanelRef = useRef<BulkPlantingPanelHandle>(null);
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

  const { data, isPending, isError } = useQuery({
    queryKey: ["beds"],
    queryFn: listBeds,
    enabled: mode === "mine",
  });
  const gardenQuery = useQuery({
    queryKey: ["garden"],
    queryFn: getGarden,
    enabled: mode === "mine",
  });
  const plantingsQuery = useQuery({
    queryKey: ["plantings"],
    queryFn: listPlantings,
    enabled: mode === "mine",
  });
  const equipmentQuery = useQuery({
    queryKey: ["bed-equipment"],
    queryFn: listBedEquipment,
    enabled: mode === "mine",
  });
  const plantsQuery = useQuery({
    queryKey: ["plants"],
    queryFn: () => listPlants(500),
  });

  const exampleGardenQuery = useQuery({
    queryKey: ["example-garden"],
    queryFn: getExampleGarden,
    enabled: mode === "example",
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

  const beds = data ?? [];
  const garden = gardenQuery.data ?? null;
  // Garden's own bounding box, in world/cm space - passed to every BedNode so
  // drag/resize/vertex-drag can be clamped to stay inside the garden's
  // boundary (see the "Bed placement must stay within the garden's
  // boundary" backlog item). Undefined when there's no garden set up yet.
  const gardenBounds = garden ? boundingRect(garden.border_geometry) : undefined;
  const plantings = plantingsQuery.data ?? [];
  const equipmentList = equipmentQuery.data ?? [];
  const selectedBed = beds.find((b) => b.id === selectedId) ?? null;
  const selectedPlanting = plantings.find((p) => p.id === selectedPlantingId) ?? null;
  // Every bed's bounding box, in world/cm space, keyed by id - so each
  // BedNode can be given every *other* bed's box for the "beds must not
  // intersect" hard constraint. Not memoized - the bed count here is a
  // small, fixed physical garden's worth, cheap to recompute per render.
  const bedRectsById = new Map(
    beds.filter((b) => b.id != null).map((b) => [b.id as number, boundingRect(b.border_geometry)]),
  );

  function switchTab(next: PlacementTab) {
    setTab(next);
    setSelectedId(null);
    setSelectedBedIds(new Set());
    setPlantPickerOpen(false);
    setSelectedPlantingId(null);
    setSelectedPlantingIds(new Set());
  }

  function openPlantPicker() {
    const rect = plantPickerAnchorRef.current?.getBoundingClientRect();
    if (rect) setPlantPickerPos({ x: rect.left, y: rect.bottom + 4 });
    setPlantPickerOpen(true);
  }

  function handlePlantPlace(bedId: number, geometry: Geometry, placementType: PlacementType) {
    if (!armedPlant) return;
    plantingCreateMutation.mutate({ bed_id: bedId, plant_slug: armedPlant.slug, placement_type: placementType, geometry });
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
   * clears the current bed selection and, on the Planters tab, starts a
   * marquee-select drag (see handleBedMarqueeMouseMove/Up below). */
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
    }
  }

  function handleBedMarqueeMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!bedMarquee) return;
    const stage = e.target.getStage();
    const pos = stage?.getRelativePointerPosition();
    if (pos) setBedMarquee((prev) => (prev ? { ...prev, current: pos } : prev));
  }

  /** Completes a bed marquee drag - every bed whose bounding box overlaps
   * the drawn rectangle gets selected. A single hit goes through the normal
   * `selectedId` (so BedPanel opens, matching a plain click); 2+ hits are
   * highlighted via `selectedBedIds` instead, since there's no bulk-bed-edit
   * panel yet (see the state's own doc above). */
  function handleBedMarqueeMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!bedMarquee) return;
    const stage = e.target.getStage();
    const pos = stage?.getRelativePointerPosition() ?? bedMarquee.current;
    const rect = normalizedRect(bedMarquee.start, pos);
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

  /** "Fit to garden": frame the garden boundary + every bed (falling back
   * to the example-garden beds in that mode) at the largest zoom that keeps
   * it all on screen - replaces "hope the fixed canvas is big enough" with
   * an actual answer. */
  function handleFitView() {
    const boxes =
      mode === "mine"
        ? [...(garden ? [boundingRect(garden.border_geometry)] : []), ...beds.map((b) => boundingRect(b.border_geometry))]
        : exampleBeds.map((b) => boundingRect(b.border_geometry));
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

  function handleBedChange(bed: Bed, geometry: Geometry) {
    if (bed.id == null) return;
    const bedId = bed.id;
    const previousGeometry = bed.border_geometry;
    applyBedGeometry(bedId, geometry);
    history.push({
      undo: () => applyBedGeometry(bedId, previousGeometry),
      redo: () => applyBedGeometry(bedId, geometry),
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

  /** Placing an inventory item onto a bed - same cascading default position
   * as the old inline handler this replaced (AddBedForm's nextBedPosition
   * follows the same idea), just lifted up here so it's one of undo/redo's
   * four tracked geometry-mutation sites. */
  function handleEquipmentPlace(item: BedEquipment, bed: Bed) {
    if (item.id == null || bed.id == null) return;
    const itemId = item.id;
    const existingInBed = equipmentList.filter((e) => e.bed_id === bed.id).length;
    const offset = (existingInBed % 5) * (DEFAULT_EQUIPMENT_SIZE_CM + 5);
    const previousPatch: BedEquipmentUpdate = { bed_id: item.bed_id, geometry: item.geometry };
    const nextPatch: BedEquipmentUpdate = {
      bed_id: bed.id,
      geometry: {
        type: "rectangle",
        x: 10 + offset,
        y: 10 + offset,
        width: DEFAULT_EQUIPMENT_SIZE_CM,
        height: DEFAULT_EQUIPMENT_SIZE_CM,
        rotation: 0,
      },
    };
    applyEquipmentPatch(itemId, nextPatch);
    history.push({
      undo: () => applyEquipmentPatch(itemId, previousPatch),
      redo: () => applyEquipmentPatch(itemId, nextPatch),
    });
  }

  function handleEquipmentReturnToInventory(item: BedEquipment) {
    if (item.id == null) return;
    const itemId = item.id;
    const previousPatch: BedEquipmentUpdate = { bed_id: item.bed_id, geometry: item.geometry };
    const nextPatch: BedEquipmentUpdate = { bed_id: null, geometry: null };
    applyEquipmentPatch(itemId, nextPatch);
    history.push({
      undo: () => applyEquipmentPatch(itemId, previousPatch),
      redo: () => applyEquipmentPatch(itemId, nextPatch),
    });
  }

  const exampleBeds = exampleGardenQuery.data?.beds ?? [];

  function handleModeChange(next: ViewMode) {
    if (next === "example") {
      setSelectedId(null);
      setSelectedBedIds(new Set());
      setSelectedPlantingIds(new Set());
    }
    setMode(next);
  }

  // Global keyboard shortcuts - only active in "mine" mode, matching the
  // four tracked undo/redo mutation sites which only exist there (the
  // example garden is read-only). Ignores every shortcut below while focus
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
  }, [mode, tab, armedPlant, selectedId, selectedPlantingId, selectedPlantingIds, historyUndo, historyRedo]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <Toolbar
        mode={mode}
        onModeChange={handleModeChange}
        tab={tab}
        onTabChange={switchTab}
        zoomPercent={viewport.scale * 100}
        onFitView={handleFitView}
        onAddBed={() => setShowAddForm(true)}
        armedPlant={armedPlant}
        onClearArmedPlant={() => setArmedPlant(null)}
        plantPickerAnchorRef={plantPickerAnchorRef}
        onOpenPlantPicker={openPlantPicker}
        placementMode={placementMode}
        onPlacementModeChange={setPlacementMode}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
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
          {(exampleGardenQuery.isPending || plantsQuery.isPending) && (
            <p className="text-sm text-muted-foreground">Loading example garden…</p>
          )}
          {(exampleGardenQuery.isError || plantsQuery.isError) && (
            <p className="text-sm text-destructive">Failed to load example garden.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Read-only preview of a realistic demo layout (data/example_garden.json) - not connected to your real
            beds. Hover a plant for its name.
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
              onMouseMove={handleBedMarqueeMouseMove}
              onMouseUp={handleBedMarqueeMouseUp}
            >
              <Layer listening={false}>
                <GridLines canvasSize={canvasSize} viewport={viewport} />
              </Layer>
              <RulerLayer canvasSize={canvasSize} viewport={viewport} />
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
                  />
                )}
                {garden && gardenBounds && (
                  <CompassWidget
                    center={{ x: gardenBounds.x + gardenBounds.width + COMPASS_MARGIN_CM, y: gardenBounds.y }}
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
                      setSelectedBedIds(new Set());
                    }}
                    onChange={(geometry) => handleBedChange(bed, geometry)}
                    interactive={tab === "planters"}
                    viewport={viewport}
                    bounds={gardenBounds}
                    otherBedRects={[...bedRectsById.entries()].filter(([id]) => id !== bed.id).map(([, rect]) => rect)}
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
              {tab === "equipment" && <EquipmentLayer beds={beds} equipment={equipmentList} />}
              {tab === "plants" && (
                <PlantPlacementLayer
                  beds={beds}
                  plantings={plantings}
                  plantsBySlug={plantsBySlug}
                  active
                  armedPlant={armedPlant}
                  placementMode={placementMode}
                  onPlace={handlePlantPlace}
                  onMove={handlePlantingMove}
                  onSelect={handlePlantingSelect}
                  selectedIds={selectedPlantingIds}
                  onMarqueeSelect={handleMarqueeSelect}
                />
              )}
            </Stage>
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
                onClose={() => setSelectedId(null)}
                onDeleted={() => setSelectedId(null)}
              />
            </div>
          )}
          {tab === "equipment" && (
            <div className="h-full overflow-y-auto">
              <EquipmentPanel
                beds={beds}
                equipment={equipmentList}
                onClose={() => switchTab("planters")}
                onPlace={handleEquipmentPlace}
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

      {mode === "example" && exampleGardenQuery.data && (
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
            <RulerLayer canvasSize={canvasSize} viewport={viewport} />
            <ExampleGardenLayer beds={exampleBeds} plantsBySlug={plantsBySlug} onHover={setTooltip} />
          </Stage>
          <PlantingTooltip tooltip={tooltip} />
        </div>
      )}

      {plantPickerOpen && (
        <PlantPicker
          x={plantPickerPos.x}
          y={plantPickerPos.y}
          plants={plantsQuery.data ?? []}
          onPick={(slug) => {
            setArmedPlant(plantsBySlug.get(slug) ?? null);
            setPlantPickerOpen(false);
          }}
          onClose={() => setPlantPickerOpen(false)}
        />
      )}

      {showAddForm && (
        <AddBedForm
          onClose={() => setShowAddForm(false)}
          onCreated={(bed) => {
            setShowAddForm(false);
            setSelectedId(bed.id ?? null);
          }}
          nextPosition={nextBedPosition(beds)}
        />
      )}
    </div>
  );
}
