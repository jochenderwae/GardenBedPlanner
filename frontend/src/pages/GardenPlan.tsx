import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PlantPicker } from "@/pages/layout/PlantPicker";
import {
  createGardenPlan,
  createGardenPlanEntry,
  deleteGardenPlan,
  deleteGardenPlanEntry,
  getGardenPlan,
  listBeds,
  listGardenPlans,
  listPlants,
  updateGardenPlan,
  updateGardenPlanEntry,
  type Bed,
  type GardenPlan as GardenPlanData,
  type GardenPlanCreate,
  type GardenPlanEntry,
  type GardenPlanEntryUpdate,
  type GardenPlanUpdate,
  type Plant,
} from "@/api/client";

/** Creates a new season/year plan, both trigger button and dialog form
 * always mounted (`open` as real state) - same Base UI focus-return
 * requirement `AddBedForm`/`AddPlantForm` already document on their own
 * `DialogTrigger`. */
function CreatePlanForm({ onCreated }: { onCreated: (plan: GardenPlanData) => void }) {
  const [open, setOpen] = useState(false);
  const [seasonName, setSeasonName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSeasonName("");
    setYear(String(new Date().getFullYear()));
    setNotes("");
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (plan: GardenPlanCreate) => createGardenPlan(plan),
    onSuccess: (created) => {
      setOpen(false);
      onCreated(created);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to create plan"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!seasonName.trim()) {
      setError("Season name is required.");
      return;
    }
    mutation.mutate({ season_name: seasonName.trim(), year: Number(year), notes: notes.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">+ New plan</Button>} />
      <DialogPopup>
        <Card className="w-full max-w-sm p-4">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-medium">New garden plan</DialogTitle>
              <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Season name</span>
              <Input placeholder="e.g. Spring 2027" value={seasonName} onChange={(e) => setSeasonName(e.target.value)} autoFocus />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Year</span>
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Notes</span>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </Card>
      </DialogPopup>
    </Dialog>
  );
}

/** One wishlist line item - plant (fixed after creation; delete + re-add
 * to change it, same "no in-place plant swap" precedent
 * `PlantingPanel.tsx` sets for a placed Planting's own plant_slug) plus
 * editable desired_quantity/bed assignment/notes, autosaving on
 * change/blur like every other panel in this app. */
function EntryRow({
  entry,
  plant,
  beds,
  onUpdated,
  onDeleted,
}: {
  entry: GardenPlanEntry;
  plant: Plant | undefined;
  beds: Bed[];
  onUpdated: (updated: GardenPlanEntry) => void;
  onDeleted: (id: number) => void;
}) {
  const [notesDraft, setNotesDraft] = useState(entry.notes);
  useEffect(() => setNotesDraft(entry.notes), [entry.notes]);

  const updateMutation = useMutation({
    mutationFn: (patch: GardenPlanEntryUpdate) =>
      updateGardenPlanEntry(entry.garden_plan_id, entry.id as number, patch),
    onSuccess: onUpdated,
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteGardenPlanEntry(entry.garden_plan_id, entry.id as number),
    onSuccess: () => onDeleted(entry.id as number),
  });

  function commit(patch: GardenPlanEntryUpdate) {
    if (entry.id == null) return;
    updateMutation.mutate(patch);
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{plant?.common_name ?? entry.plant_slug}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${plant?.common_name ?? entry.plant_slug} from the plan`}
          onClick={() => deleteMutation.mutate()}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Desired quantity</span>
          <Input
            type="number"
            min={1}
            value={entry.desired_quantity}
            onChange={(e) => commit({ desired_quantity: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Bed</span>
          <Select
            value={entry.bed_id != null ? String(entry.bed_id) : ""}
            onChange={(e) => commit({ bed_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Not yet assigned</option>
            {beds.map((bed) => (
              <option key={bed.id} value={String(bed.id)}>
                {bed.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Notes</span>
        <Input value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} onBlur={() => notesDraft !== entry.notes && commit({ notes: notesDraft })} />
      </label>
    </div>
  );
}

/** Adds a new wishlist entry to the currently-open plan - plant picker,
 * desired quantity, optional bed. */
function AddEntryForm({ planId, beds, plants, onAdded }: { planId: number; beds: Bed[]; plants: Plant[]; onAdded: (entry: GardenPlanEntry) => void }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [bedId, setBedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createGardenPlanEntry(planId, {
        plant_slug: slug as string,
        bed_id: bedId ? Number(bedId) : null,
        desired_quantity: Number(quantity) || 1,
        notes: "",
      }),
    onSuccess: (created) => {
      onAdded(created);
      setSlug(null);
      setQuantity("1");
      setBedId("");
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to add entry"),
  });

  const armedPlant = slug ? (plants.find((p) => p.slug === slug) ?? null) : null;

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlantPicker plants={plants} armedPlant={armedPlant} onPick={setSlug} />
        <Input
          type="number"
          min={1}
          className="w-20"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-label="Desired quantity"
        />
        <Select className="flex-1" value={bedId} onChange={(e) => setBedId(e.target.value)} aria-label="Bed">
          <option value="">Not yet assigned</option>
          {beds.map((bed) => (
            <option key={bed.id} value={String(bed.id)}>
              {bed.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={!slug || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Garden plan / plantings wishlist (#220) - a season's plant wishlist
 * (`GardenPlan` + `GardenPlanEntry`), separate from real `Planting` rows:
 * intent ("I want N tomatoes this year"), not yet placed geometry. Desktop-
 * only per the ticket's own settled Platform note (season planning, closer
 * to Agenda/SeedGuide than a mobile quick-action). Promoting an entry into
 * a real Planting on the canvas is explicitly out of this ticket's scope -
 * a fast-follow once this list exists. */
export function GardenPlan() {
  const queryClient = useQueryClient();
  const plansQuery = useQuery({ queryKey: ["garden-plans"], queryFn: listGardenPlans });
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  const plans = plansQuery.data ?? [];
  const beds = bedsQuery.data ?? [];
  const plants = plantsQuery.data ?? [];
  const plantsBySlug = new Map(plants.map((p) => [p.slug, p]));

  // Default to the most recently created plan once plans load, if nothing
  // is selected yet - not just always the first one, so a freshly created
  // plan (appended last) becomes the active one automatically.
  const effectivePlanId = selectedPlanId ?? plans[plans.length - 1]?.id ?? null;

  const planDetailQuery = useQuery({
    queryKey: ["garden-plan", effectivePlanId],
    queryFn: () => getGardenPlan(effectivePlanId as number),
    enabled: effectivePlanId != null,
  });

  const headerMutation = useMutation({
    mutationFn: (patch: GardenPlanUpdate) => updateGardenPlan(effectivePlanId as number, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<GardenPlanData[]>(["garden-plans"], (old) =>
        old ? old.map((p) => (p.id === updated.id ? updated : p)) : old,
      );
      queryClient.setQueryData(["garden-plan", effectivePlanId], (old: typeof planDetailQuery.data) =>
        old ? { ...old, ...updated } : old,
      );
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: () => deleteGardenPlan(effectivePlanId as number, true),
    onSuccess: () => {
      queryClient.setQueryData<GardenPlanData[]>(["garden-plans"], (old) =>
        old?.filter((p) => p.id !== effectivePlanId),
      );
      setSelectedPlanId(null);
    },
  });

  const [notesDraft, setNotesDraft] = useState(planDetailQuery.data?.notes ?? "");
  useEffect(() => setNotesDraft(planDetailQuery.data?.notes ?? ""), [planDetailQuery.data?.notes]);

  function handleEntryUpdated(updated: GardenPlanEntry) {
    queryClient.setQueryData(["garden-plan", effectivePlanId], (old: typeof planDetailQuery.data) =>
      old ? { ...old, entries: old.entries.map((e) => (e.id === updated.id ? updated : e)) } : old,
    );
  }
  function handleEntryDeleted(id: number) {
    queryClient.setQueryData(["garden-plan", effectivePlanId], (old: typeof planDetailQuery.data) =>
      old ? { ...old, entries: old.entries.filter((e) => e.id !== id) } : old,
    );
  }
  function handleEntryAdded(entry: GardenPlanEntry) {
    queryClient.setQueryData(["garden-plan", effectivePlanId], (old: typeof planDetailQuery.data) =>
      old ? { ...old, entries: [...old.entries, entry] } : old,
    );
  }

  const isPending = plansQuery.isPending || bedsQuery.isPending || plantsQuery.isPending;
  const isError = plansQuery.isError || bedsQuery.isError || plantsQuery.isError;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-medium">Garden plan</h1>
        <CreatePlanForm
          onCreated={(plan) => {
            queryClient.setQueryData<GardenPlanData[]>(["garden-plans"], (old) => (old ? [...old, plan] : [plan]));
            setSelectedPlanId(plan.id ?? null);
          }}
        />
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load.</p>}

      {!isPending && !isError && plans.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No garden plans yet - start one with "+ New plan" to build next season's plant wishlist before touching the
          layout editor.
        </p>
      )}

      {!isPending && !isError && plans.length > 0 && (
        <div className="flex flex-col gap-4">
          {plans.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              Plan
              <Select
                className="w-auto"
                value={effectivePlanId != null ? String(effectivePlanId) : ""}
                onChange={(e) => setSelectedPlanId(Number(e.target.value))}
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={String(plan.id)}>
                    {plan.season_name} ({plan.year})
                  </option>
                ))}
              </Select>
            </label>
          )}

          {planDetailQuery.isPending && <p className="text-sm text-muted-foreground">Loading plan…</p>}
          {planDetailQuery.isError && <p className="text-sm text-destructive">Failed to load plan.</p>}

          {planDetailQuery.data && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {planDetailQuery.data.season_name} ({planDetailQuery.data.year})
                  </CardTitle>
                  {/* #248: CardAction (not a flex-row override) is what
                      actually gets CardHeader's own grid to lay this out
                      next to the title - see TimelineDetailPanel.tsx's own
                      comment on the same fix. */}
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete plan"
                      onClick={() => deletePlanMutation.mutate()}
                    >
                      <Trash2 />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Notes</span>
                    <Textarea
                      rows={2}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      onBlur={() => notesDraft !== planDetailQuery.data?.notes && headerMutation.mutate({ notes: notesDraft })}
                    />
                  </label>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Plants ({planDetailQuery.data.entries.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {planDetailQuery.data.entries.length === 0 && (
                    <p className="text-xs text-muted-foreground">No plants on this plan yet.</p>
                  )}
                  {planDetailQuery.data.entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      plant={plantsBySlug.get(entry.plant_slug)}
                      beds={beds}
                      onUpdated={handleEntryUpdated}
                      onDeleted={handleEntryDeleted}
                    />
                  ))}
                  <AddEntryForm planId={effectivePlanId as number} beds={beds} plants={plants} onAdded={handleEntryAdded} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
