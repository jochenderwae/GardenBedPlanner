import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Line } from "react-konva";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { listBeds, updateBed, type Bed, type BedUpdate } from "@/api/client";
import { BedNode } from "./layout/BedNode";
import { BedPanel } from "./layout/BedPanel";
import { AddBedForm } from "./layout/AddBedForm";
import { CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX, GRID_SPACING_CM } from "./layout/geometry";

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

  const { data, isPending, isError } = useQuery({
    queryKey: ["beds"],
    queryFn: listBeds,
  });

  const geometryMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BedUpdate }) => updateBed(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bed[]>(["beds"], (old) =>
        old ? old.map((b) => (b.id === updated.id ? updated : b)) : old,
      );
    },
  });

  const beds = data ?? [];
  const selectedBed = beds.find((b) => b.id === selectedId) ?? null;

  function handleBedChange(
    bed: Bed,
    patch: { pos_x: number; pos_y: number; width_cm?: number; length_cm?: number },
  ) {
    if (bed.id == null) return;
    // Optimistic: the Konva node already reflects the drag/resize visually
    // (Konva owns it during the gesture) - mirror that into the query cache
    // immediately so a re-render before the PATCH resolves doesn't snap it
    // back to the stale position, then reconcile with the server response.
    queryClient.setQueryData<Bed[]>(["beds"], (old) =>
      old ? old.map((b) => (b.id === bed.id ? { ...b, ...patch } : b)) : old,
    );
    geometryMutation.mutate({ id: bed.id, patch });
  }

  return (
    <div className="flex min-h-svh flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/" className={buttonVariants({ variant: "outline" })}>
            Back
          </Link>
          <h1 className="text-xl font-medium">Bed layout</h1>
        </div>
        <Button size="sm" onClick={() => setShowAddForm(true)}>
          <Plus /> Add bed
        </Button>
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading beds…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load beds.</p>}

      {data && (
        <div className="flex items-start gap-4">
          <div className="max-w-full overflow-auto rounded-md border">
            <Stage
              width={CANVAS_WIDTH_PX}
              height={CANVAS_HEIGHT_PX}
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) setSelectedId(null);
              }}
            >
              <Layer listening={false}>
                <GridLines />
              </Layer>
              <Layer>
                {beds.map((bed) => (
                  <BedNode
                    key={bed.id}
                    bed={bed}
                    isSelected={bed.id === selectedId}
                    onSelect={() => setSelectedId(bed.id ?? null)}
                    onChange={(patch) => handleBedChange(bed, patch)}
                  />
                ))}
              </Layer>
            </Stage>
          </div>

          {selectedBed && (
            <BedPanel bed={selectedBed} onClose={() => setSelectedId(null)} onDeleted={() => setSelectedId(null)} />
          )}
        </div>
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
