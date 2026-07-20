import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Line } from "react-konva";
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
  updatePlanting,
  type Bed,
  type BedUpdate,
  type Garden,
  type GardenPut,
  type Geometry,
  type PlacementType,
  type Plant,
  type Planting,
  type PlantingUpdate,
} from "@/api/client";
import { BedNode } from "./layout/BedNode";
import { BedPanel } from "./layout/BedPanel";
import { AddBedForm } from "./layout/AddBedForm";
import { ExampleGardenLayer, PlantingTooltip, type PlantingTooltipState } from "./layout/ExampleGardenView";
import { GardenBoundary } from "./layout/GardenBoundary";
import { GardenPanel } from "./layout/GardenPanel";
import { EquipmentLayer } from "./layout/EquipmentLayer";
import { EquipmentPanel } from "./layout/EquipmentPanel";
import { PlantPlacementLayer, type PlacementMode } from "./layout/PlantPlacementLayer";
import { PlantPicker } from "./layout/PlantPicker";
import { PlantingPanel } from "./layout/PlantingPanel";
import { RulerLayer } from "./layout/RulerLayer";
import { Toolbar, type PlacementTab, type ViewMode } from "./layout/Toolbar";
import { boundingRect, CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX, GRID_SPACING_CM } from "./layout/geometry";
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
  const [tooltip, setTooltip] = useState<PlantingTooltipState | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);

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
    setPlantPickerOpen(false);
    setSelectedPlantingId(null);
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

  /** Guards the Stage's own drag-to-pan against child nodes (beds, garden
   * boundary, polygon vertices, plantings) that are themselves `draggable`.
   * Konva's Stage-drag is triggered by any pointerdown inside the canvas
   * container regardless of which child shape was actually hit - it is
   * *not* stopped by a child node's own `draggable`/`dragBoundFunc` the way
   * DOM event bubbling would suppress a parent handler. Without this guard,
   * dragging a bed or a polygon vertex also pans the whole garden view at
   * the same time. Konva's own documented fix: on `dragstart`, if the
   * event's target isn't the Stage itself, immediately stop the Stage's
   * drag so only the child node's own drag proceeds. */
  function handleStageDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    const stage = e.target.getStage();
    if (!stage) return;
    if (e.target !== stage) {
      stage.stopDrag();
    }
  }

  /** Stage's own drag (empty-canvas drag-to-pan only, see the dragstart
   * guard above). Konva owns the position during the gesture same as every
   * other drag in this editor; mirror it into `viewport` state once the
   * gesture ends. */
  function handleStageDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    if (e.target !== e.target.getStage()) return;
    setViewport((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
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
    setViewport(fitViewport(boxes, CANVAS_SIZE));
  }

  function handleBedChange(bed: Bed, geometry: Geometry) {
    if (bed.id == null) return;
    // Optimistic: the Konva node already reflects the drag/resize/rotate
    // visually (Konva owns it during the gesture) - mirror that into the
    // query cache immediately so a re-render before the PATCH resolves
    // doesn't snap it back to the stale shape, then reconcile with the
    // server response.
    queryClient.setQueryData<Bed[]>(["beds"], (old) =>
      old ? old.map((b) => (b.id === bed.id ? { ...b, border_geometry: geometry } : b)) : old,
    );
    geometryMutation.mutate({ id: bed.id, patch: { border_geometry: geometry } });
  }

  function handleGardenGeometryChange(geometry: Geometry) {
    if (!garden) return;
    queryClient.setQueryData<Garden>(["garden"], (old) => (old ? { ...old, border_geometry: geometry } : old));
    gardenGeometryMutation.mutate({
      name: garden.name,
      climate_zone: garden.climate_zone,
      location: garden.location,
      orientation_deg: garden.orientation_deg,
      notes: garden.notes,
      border_geometry: geometry,
    });
  }

  function handlePlantingMove(planting: Planting, geometry: Geometry) {
    if (planting.id == null) return;
    queryClient.setQueryData<Planting[]>(["plantings"], (old) =>
      old ? old.map((p) => (p.id === planting.id ? { ...p, geometry } : p)) : old,
    );
    plantingUpdateMutation.mutate({ id: planting.id, patch: { geometry } });
  }

  const exampleBeds = exampleGardenQuery.data?.beds ?? [];

  function handleModeChange(next: ViewMode) {
    if (next === "example") setSelectedId(null);
    setMode(next);
  }

  return (
    <div className="flex min-h-svh flex-col gap-4 p-6">
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
      />
      <p className="text-xs text-muted-foreground">
        Scroll to pan, Ctrl/Cmd+scroll to zoom, drag empty canvas to pan.
      </p>

      {mode === "mine" && (
        <>
          {isPending && <p className="text-sm text-muted-foreground">Loading beds…</p>}
          {isError && <p className="text-sm text-destructive">Failed to load beds.</p>}
          {tab === "plants" && (
            <p className="text-xs text-muted-foreground">
              {armedPlant
                ? placementMode === "individual"
                  ? `Click inside any bed to place ${armedPlant.common_name}.`
                  : `Drag inside any bed to draw where the ${armedPlant.common_name} ${
                      placementMode === "row" ? "row" : "area"
                    } goes.`
                : "Pick a plant above, then draw where it goes: click for a single plant, drag for a row or area."}{" "}
              Click a placed plant to edit or remove it, drag it to move it.
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
        <div className="flex items-start gap-4">
          <div className="relative max-w-full overflow-auto rounded-md border">
            <Stage
              width={CANVAS_WIDTH_PX}
              height={CANVAS_HEIGHT_PX}
              x={viewport.x}
              y={viewport.y}
              scaleX={viewport.scale}
              scaleY={viewport.scale}
              draggable
              onWheel={handleWheel}
              onDragStart={handleStageDragStart}
              onDragEnd={handleStageDragEnd}
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                }
              }}
            >
              <Layer listening={false}>
                <GridLines canvasSize={CANVAS_SIZE} viewport={viewport} />
              </Layer>
              <RulerLayer canvasSize={CANVAS_SIZE} viewport={viewport} />
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
                {beds.map((bed) => (
                  <BedNode
                    key={bed.id}
                    bed={bed}
                    isSelected={tab === "planters" && bed.id === selectedId}
                    onSelect={() => setSelectedId(bed.id ?? null)}
                    onChange={(geometry) => handleBedChange(bed, geometry)}
                    interactive={tab === "planters"}
                    viewport={viewport}
                    bounds={gardenBounds}
                    otherBedRects={[...bedRectsById.entries()].filter(([id]) => id !== bed.id).map(([, rect]) => rect)}
                  />
                ))}
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
                  onSelect={(planting) => setSelectedPlantingId(planting.id ?? null)}
                />
              )}
            </Stage>
          </div>

          {tab === "garden" && <GardenPanel garden={garden} onClose={() => switchTab("planters")} />}
          {tab === "planters" && selectedBed && (
            <BedPanel bed={selectedBed} onClose={() => setSelectedId(null)} onDeleted={() => setSelectedId(null)} />
          )}
          {tab === "equipment" && (
            <EquipmentPanel beds={beds} equipment={equipmentList} onClose={() => switchTab("planters")} />
          )}
          {tab === "plants" && selectedPlanting && (
            <PlantingPanel
              planting={selectedPlanting}
              plant={plantsBySlug.get(selectedPlanting.plant_slug)}
              onClose={() => setSelectedPlantingId(null)}
              onDeleted={() => setSelectedPlantingId(null)}
            />
          )}
        </div>
      )}

      {mode === "example" && exampleGardenQuery.data && (
        <div className="relative max-w-full overflow-auto rounded-md border">
          <Stage
            width={CANVAS_WIDTH_PX}
            height={CANVAS_HEIGHT_PX}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            draggable
            onWheel={handleWheel}
            onDragStart={handleStageDragStart}
            onDragEnd={handleStageDragEnd}
          >
            <Layer listening={false}>
              <GridLines canvasSize={CANVAS_SIZE} viewport={viewport} />
            </Layer>
            <RulerLayer canvasSize={CANVAS_SIZE} viewport={viewport} />
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
