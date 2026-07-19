import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Line } from "react-konva";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
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
import { CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX, DEFAULT_PLANTING_DIAMETER_CM, GRID_SPACING_CM } from "./layout/geometry";

type ViewMode = "mine" | "example";
type PlacementTab = "planters" | "equipment" | "plants";

const TAB_LABELS: Record<PlacementTab, string> = {
  planters: "Planters",
  equipment: "Equipment",
  plants: "Plants",
};

function GridLines() {
  const lines = useMemo(() => {
    const vertical = [];
    for (let x = 0; x <= CANVAS_WIDTH_PX; x += GRID_SPACING_CM) {
      vertical.push(<Line key={`v${x}`} points={[x, 0, x, CANVAS_HEIGHT_PX]} stroke="#e5e7eb" strokeWidth={1} />);
    }
    const horizontal = [];
    for (let y = 0; y <= CANVAS_HEIGHT_PX; y += GRID_SPACING_CM) {
      horizontal.push(<Line key={`h${y}`} points={[0, y, CANVAS_WIDTH_PX, y]} stroke="#e5e7eb" strokeWidth={1} />);
    }
    return [...vertical, ...horizontal];
  }, []);
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
  const plantings = plantingsQuery.data ?? [];
  const equipmentList = equipmentQuery.data ?? [];
  const selectedBed = beds.find((b) => b.id === selectedId) ?? null;

  function switchTab(next: PlacementTab) {
    setTab(next);
    setSelectedId(null);
    setGardenPanelOpen(false);
    setPicker(null);
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
        {mode === "mine" && tab === "planters" && (
          <div className="flex gap-2">
            {gardenQuery.isSuccess && !garden && (
              <Button size="sm" variant="outline" onClick={() => setGardenPanelOpen(true)}>
                Set up garden
              </Button>
            )}
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus /> Add bed
            </Button>
          </div>
        )}
      </div>

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
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                  setGardenPanelOpen(false);
                }
              }}
            >
              <Layer listening={false}>
                <GridLines />
              </Layer>
              <RulerLayer widthCm={CANVAS_WIDTH_PX} heightCm={CANVAS_HEIGHT_PX} />
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
          <Stage width={CANVAS_WIDTH_PX} height={CANVAS_HEIGHT_PX}>
            <Layer listening={false}>
              <GridLines />
            </Layer>
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
