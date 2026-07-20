import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Line } from "react-konva";
import type Konva from "konva";
import { Link } from "react-router-dom";
import { Plus, Maximize } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createPlanting,
  deletePlanting,
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
  type Plant,
  type Planting,
  type PlantingCreate,
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
import { PlantPlacementLayer, type PickerState } from "./layout/PlantPlacementLayer";
import { PlantPicker } from "./layout/PlantPicker";
import { RulerLayer } from "./layout/RulerLayer";
import { boundingRect, CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX, DEFAULT_PLANTING_DIAMETER_CM, GRID_SPACING_CM } from "./layout/geometry";
import {
  clampScale,
  DEFAULT_VIEWPORT,
  fitViewport,
  visibleWorldBounds,
  zoomAtPoint,
  type Size,
  type Viewport,
} from "./layout/viewport";

type ViewMode = "mine" | "example";
type PlacementTab = "planters" | "equipment" | "plants";

const TAB_LABELS: Record<PlacementTab, string> = {
  planters: "Planters",
  equipment: "Equipment",
  plants: "Plants",
};

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
  const [tab, setTab] = useState<PlacementTab>("planters");
  const [gardenPanelOpen, setGardenPanelOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
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
    mutationFn: (payload: PlantingCreate) => createPlanting(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) => (old ? [...old, created] : [created]));
      setPicker(null);
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
  const plantingDeleteMutation = useMutation({
    mutationFn: (id: number) => deletePlanting(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<Planting[]>(["plantings"], (old) => old?.filter((p) => p.id !== id));
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
    setGardenPanelOpen(false);
    setPicker(null);
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

  /** Stage's own drag (empty-canvas drag-to-pan - beds/plantings/vertices
   * each have their own `draggable` and capture the gesture before it
   * bubbles to the Stage, so this only fires for panning). Konva owns the
   * position during the gesture same as every other drag in this editor;
   * mirror it into `viewport` state once the gesture ends. */
  function handleStageDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
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

  function handlePlantingDelete(planting: Planting) {
    if (planting.id == null) return;
    const label = plantsBySlug.get(planting.plant_slug)?.common_name ?? planting.plant_slug;
    if (confirm(`Remove ${label}?`)) plantingDeleteMutation.mutate(planting.id);
  }

  const exampleBeds = exampleGardenQuery.data?.beds ?? [];

  return (
    <div className="flex min-h-svh flex-col gap-4 p-6">
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
              onClick={() => setMode("mine")}
            >
              My beds
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                mode === "example" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
              onClick={() => {
                setSelectedId(null);
                setMode("example");
              }}
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
                  onClick={() => switchTab(t)}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(viewport.scale * 100)}%
          </span>
          <Button size="sm" variant="outline" onClick={handleFitView} title="Fit the whole garden in view">
            <Maximize /> Fit view
          </Button>
          {mode === "mine" && tab === "planters" && (
            <>
              {gardenQuery.isSuccess && !garden && (
                <Button size="sm" variant="outline" onClick={() => setGardenPanelOpen(true)}>
                  Set up garden
                </Button>
              )}
              <Button size="sm" onClick={() => setShowAddForm(true)}>
                <Plus /> Add bed
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Scroll to pan, Ctrl/Cmd+scroll to zoom, drag empty canvas to pan.
      </p>

      {mode === "mine" && (
        <>
          {isPending && <p className="text-sm text-muted-foreground">Loading beds…</p>}
          {isError && <p className="text-sm text-destructive">Failed to load beds.</p>}
          {tab === "plants" && (
            <p className="text-xs text-muted-foreground">
              Click inside any bed (including open ground) to place a plant. Drag a placed plant to move it,
              double-click to remove it.
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
              onDragEnd={handleStageDragEnd}
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                  setGardenPanelOpen(false);
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
                    isSelected={gardenPanelOpen}
                    onSelect={() => {
                      setSelectedId(null);
                      setGardenPanelOpen(true);
                    }}
                    onChange={handleGardenGeometryChange}
                    interactive={tab === "planters"}
                    viewport={viewport}
                  />
                )}
                {beds.map((bed) => (
                  <BedNode
                    key={bed.id}
                    bed={bed}
                    isSelected={tab === "planters" && bed.id === selectedId}
                    onSelect={() => {
                      setGardenPanelOpen(false);
                      setSelectedId(bed.id ?? null);
                    }}
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
                  onOpenPicker={setPicker}
                  onMove={handlePlantingMove}
                  onDelete={handlePlantingDelete}
                />
              )}
            </Stage>
          </div>

          {tab === "planters" && selectedBed && (
            <BedPanel bed={selectedBed} onClose={() => setSelectedId(null)} onDeleted={() => setSelectedId(null)} />
          )}
          {tab === "planters" && !selectedBed && gardenPanelOpen && (
            <GardenPanel garden={garden} onClose={() => setGardenPanelOpen(false)} />
          )}
          {tab === "equipment" && (
            <EquipmentPanel beds={beds} equipment={equipmentList} onClose={() => switchTab("planters")} />
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

      {picker && (
        <PlantPicker
          x={picker.screenX}
          y={picker.screenY}
          plants={plantsQuery.data ?? []}
          onPick={(slug) =>
            plantingCreateMutation.mutate({
              bed_id: picker.bedId,
              plant_slug: slug,
              placement_type: "individual",
              geometry: {
                type: "rectangle",
                x: picker.x - DEFAULT_PLANTING_DIAMETER_CM / 2,
                y: picker.y - DEFAULT_PLANTING_DIAMETER_CM / 2,
                width: DEFAULT_PLANTING_DIAMETER_CM,
                height: DEFAULT_PLANTING_DIAMETER_CM,
                rotation: 0,
              },
              planted_date: null,
              removed_date: null,
            })
          }
          onClose={() => setPicker(null)}
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
