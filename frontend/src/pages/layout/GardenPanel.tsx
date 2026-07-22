import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { putGarden, type Garden, type GardenPut } from "@/api/client";

const DEFAULT_GARDEN_SIZE_CM = 500;

interface GardenPanelProps {
  garden: Garden | null;
}

/** Metadata editor for the Garden singleton, plus its own empty-state
 * create form when no Garden row exists yet. Creating one here also
 * auto-creates a matching ground Bed server-side (see
 * app/api/routes/garden.py) - the default "plant directly in the garden"
 * surface - which is why this panel doesn't need its own "add a ground bed"
 * affordance. No close ("X") button - unlike BedPanel/EquipmentPanel/
 * PlantingPanel (which close back to a list/tab), the garden is reached via
 * its own always-present "Garden" tab, so there's nothing to close back to. */
export function GardenPanel({ garden }: GardenPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Garden | null>(garden);
  const [name, setName] = useState("My Garden");

  useEffect(() => setDraft(garden), [garden]);

  const mutation = useMutation({
    mutationFn: (payload: GardenPut) => putGarden(payload),
    onSuccess: (updated) => {
      queryClient.setQueryData<Garden>(["garden"], updated);
      queryClient.invalidateQueries({ queryKey: ["beds"] });
    },
  });

  function commit(patch: Partial<GardenPut>) {
    if (!draft) return;
    const payload: GardenPut = {
      name: draft.name,
      climate_zone: draft.climate_zone,
      location: draft.location,
      orientation_deg: draft.orientation_deg,
      notes: draft.notes,
      border_geometry: draft.border_geometry,
      ...patch,
    };
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    mutation.mutate(payload);
  }

  if (!draft) {
    return (
      <Card className="w-72 p-4">
        <h2 className="mb-3 text-sm font-medium">Set up garden</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Draws a {DEFAULT_GARDEN_SIZE_CM}×{DEFAULT_GARDEN_SIZE_CM}cm starting boundary - drag/resize/rotate it into
          shape afterward. Also creates a ground-level bed you can plant directly into.
        </p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1" title="Your garden's display name.">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <Button
            size="sm"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                name,
                climate_zone: null,
                location: null,
                orientation_deg: 0,
                notes: "",
                border_geometry: {
                  type: "rectangle",
                  x: 20,
                  y: 20,
                  width: DEFAULT_GARDEN_SIZE_CM,
                  height: DEFAULT_GARDEN_SIZE_CM,
                  rotation: 0,
                },
              })
            }
          >
            {mutation.isPending ? "Creating…" : "Create garden"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-72 p-4">
      <h2 className="mb-3 text-sm font-medium">Edit garden</h2>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1" title="Your garden's display name.">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <Input
            value={draft.name}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            onBlur={() => draft.name !== garden?.name && commit({ name: draft.name })}
          />
        </label>

        <label
          className="flex flex-col gap-1"
          title="Free-text climate zone, e.g. a Köppen or USDA hardiness zone code, if you track one."
        >
          <span className="text-xs font-medium text-muted-foreground">Climate zone</span>
          <Input
            value={draft.climate_zone ?? ""}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, climate_zone: e.target.value || null } : prev))}
            onBlur={() => draft.climate_zone !== garden?.climate_zone && commit({ climate_zone: draft.climate_zone })}
          />
        </label>

        <label className="flex flex-col gap-1" title="Free-text location, e.g. a city or address.">
          <span className="text-xs font-medium text-muted-foreground">Location</span>
          <Input
            value={draft.location ?? ""}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, location: e.target.value || null } : prev))}
            onBlur={() => draft.location !== garden?.location && commit({ location: draft.location })}
          />
        </label>

        <label className="flex flex-col gap-1" title="Any other notes about the garden.">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <Textarea
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
            onBlur={() => draft.notes !== garden?.notes && commit({ notes: draft.notes })}
          />
        </label>
      </div>
    </Card>
  );
}
