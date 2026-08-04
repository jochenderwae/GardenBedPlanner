import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { activateGarden, createGarden, listGardens, type Garden, type GardenWrite } from "@/api/client";

/** A brand new garden starts with a small, plain rectangle border - no
 * geometry-input UI here (this app has no "draw your first garden boundary"
 * setup flow at all, since a garden always already exists in practice - see
 * this ticket's own Technical analysis). The user resizes/repositions it
 * afterward from the Layout editor's own Garden tab, the same as any other
 * bed/garden boundary. */
const DEFAULT_NEW_GARDEN_GEOMETRY: GardenWrite["border_geometry"] = {
  type: "rectangle",
  x: 0,
  y: 0,
  width: 600,
  height: 400,
  rotation: 0,
};

/** Every garden-scoped query this app has - switching the active garden
 * (`activateGarden`) changes what every one of these resolves to server-
 * side, so all of them need to refetch. Same broad-invalidation pattern
 * `Layout.tsx`'s own `OnboardingPrompt` `onSeeded` callback already uses
 * after a similarly wide-reaching mutation (seeding beds/plantings/
 * equipment in one go). */
function invalidateGardenScopedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["gardens"] });
  queryClient.invalidateQueries({ queryKey: ["garden"] });
  queryClient.invalidateQueries({ queryKey: ["beds"] });
  queryClient.invalidateQueries({ queryKey: ["plantings"] });
  queryClient.invalidateQueries({ queryKey: ["bed-equipment"] });
  queryClient.invalidateQueries({ queryKey: ["actions"] });
  queryClient.invalidateQueries({ queryKey: ["harvest-logs"] });
  queryClient.invalidateQueries({ queryKey: ["compost-bins"] });
  queryClient.invalidateQueries({ queryKey: ["compost-fertilization-logs"] });
  queryClient.invalidateQueries({ queryKey: ["garden-plans"] });
  queryClient.invalidateQueries({ queryKey: ["garden-plan"] });
  queryClient.invalidateQueries({ queryKey: ["irrigation-zones"] });
  queryClient.invalidateQueries({ queryKey: ["irrigation-zone"] });
  queryClient.invalidateQueries({ queryKey: ["irrigation-parts"] });
  queryClient.invalidateQueries({ queryKey: ["irrigation-connections"] });
}

/** Settings page (#239/#235) - the only new UI multi-garden support (#238)
 * needs for this pass, per the user's own 2026-08-03 scope decision: every
 * garden the user has created, and a way to switch which one is active. No
 * garden-switcher anywhere else in the app, no combined cross-garden views -
 * every existing page keeps working exactly as it does today, just against
 * whichever garden is currently active. */
export function Settings() {
  const queryClient = useQueryClient();
  const gardensQuery = useQuery({ queryKey: ["gardens"], queryFn: listGardens });
  const [newGardenName, setNewGardenName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const gardens = gardensQuery.data ?? [];
  const activeGarden = gardens.find((g) => g.is_active);

  const activateMutation = useMutation({
    mutationFn: (id: number) => activateGarden(id),
    onSuccess: () => invalidateGardenScopedQueries(queryClient),
  });

  const createMutation = useMutation({
    mutationFn: (garden: GardenWrite) => createGarden(garden),
    onSuccess: (created) => {
      queryClient.setQueryData<Garden[]>(["gardens"], (old) => (old ? [...old, created] : [created]));
      setNewGardenName("");
    },
    onError: (err: unknown) => setFormError(err instanceof Error ? err.message : "Failed to add garden"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!newGardenName.trim()) {
      setFormError("Name is required.");
      return;
    }
    createMutation.mutate({
      name: newGardenName.trim(),
      climate_zone: null,
      location: null,
      orientation_deg: 0,
      notes: "",
      border_geometry: DEFAULT_NEW_GARDEN_GEOMETRY,
    });
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-xl font-medium">Settings</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Every garden you've created, and which one is currently active. Every other page in this app - Bed Planner,
        Agenda, Timeline, and the rest - always reflects whichever garden is active here.
      </p>

      {gardensQuery.isPending && <p className="text-sm text-muted-foreground">Loading gardens…</p>}
      {gardensQuery.isError && <p className="text-sm text-destructive">Failed to load gardens.</p>}

      {!gardensQuery.isPending && !gardensQuery.isError && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Active garden</CardTitle>
            </CardHeader>
            <CardContent>
              <label className="flex flex-col gap-1" htmlFor="settings-active-garden">
                <span className="text-xs font-medium text-muted-foreground">Garden</span>
                <Select
                  id="settings-active-garden"
                  value={activeGarden?.id != null ? String(activeGarden.id) : ""}
                  disabled={activateMutation.isPending}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (Number.isFinite(id)) activateMutation.mutate(id);
                  }}
                >
                  {gardens.map((garden) => (
                    <option key={garden.id} value={String(garden.id)}>
                      {garden.name}
                    </option>
                  ))}
                </Select>
              </label>
              {activateMutation.isPending && <p className="mt-2 text-xs text-muted-foreground">Switching garden…</p>}
              {activateMutation.isError && (
                <p className="mt-2 text-xs text-destructive">Failed to switch the active garden.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add a garden</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3" onSubmit={submit}>
                <label className="flex flex-col gap-1" htmlFor="settings-new-garden-name">
                  <span className="text-xs font-medium text-muted-foreground">Name</span>
                  <Input
                    id="settings-new-garden-name"
                    placeholder="e.g. Allotment plot"
                    value={newGardenName}
                    onChange={(e) => setNewGardenName(e.target.value)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Starts with a small default boundary you can resize from the Bed Planner's Garden tab, and starts
                  inactive - switch to it above once you're ready to work in it.
                </p>
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <Button type="submit" size="sm" className="self-start" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Adding…" : "Add garden"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
