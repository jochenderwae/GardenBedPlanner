import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  createCompostBin,
  createCompostFertilizationLog,
  listActions,
  listBeds,
  listCompostBins,
  listCompostFertilizationLogs,
  listPlantings,
  listPlants,
  updateCompostBin,
  type Action,
  type Bed,
  type CompostBin,
  type CompostBinUpdate,
  type CompostFertilizationLog,
  type CompostFertilizationLogCreate,
  type Plant,
  type Planting,
} from "@/api/client";
import { todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { HarvestLogDialog } from "@/pages/harvest/HarvestLogDialog";
import { harvestDisabledReason, resolveHarvestPlanting } from "@/pages/harvest/harvestPlanting";

const FILL_STATE_OPTIONS: { value: CompostBin["fill_state"]; label: string }[] = [
  { value: "empty", label: "Empty" },
  { value: "filling", label: "Filling" },
  { value: "full", label: "Full" },
  { value: "curing", label: "Curing" },
];

function bedName(bedsById: Map<number, Bed>, bedId: number): string {
  return bedsById.get(bedId)?.name ?? `Bed #${bedId}`;
}

/** Log a compost/fertilizer application against a bed - product, amount
 * (free text, e.g. "2 wheelbarrows" or "a 5cm layer" - see
 * `CompostFertilizationLog`'s own schema doc on why amount isn't a
 * structured numeric+unit pair), date, notes (#223). Always creates a new
 * unplaced log row; there's no "edit a past log" UI here, matching
 * `EquipmentPanel.tsx`'s own "quick add" form precedent - a genuine
 * mis-log is rare enough not to need one yet. */
function CompostLogForm({ beds }: { beds: Bed[] }) {
  const queryClient = useQueryClient();
  const [bedId, setBedId] = useState("");
  const [type, setType] = useState<CompostFertilizationLogCreate["type"]>("compost");
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [logDate, setLogDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (log: CompostFertilizationLogCreate) => createCompostFertilizationLog(log),
    onSuccess: (created) => {
      queryClient.setQueryData<CompostFertilizationLog[]>(["compost-fertilization-logs"], (old) =>
        old ? [created, ...old] : [created],
      );
      setProduct("");
      setAmount("");
      setNotes("");
      // bed/type/date deliberately kept - logging several entries for the
      // same bed/day (e.g. compost then a fertilizer top-up) is the common
      // case, not a one-off.
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to save log"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!bedId) {
      setError("Choose a bed.");
      return;
    }
    createMutation.mutate({
      bed_id: Number(bedId),
      log_date: logDate,
      type,
      product: product.trim(),
      amount: amount.trim(),
      notes: notes.trim(),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Log compost / fertilizer</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Bed</span>
            <Select value={bedId} onChange={(e) => setBedId(e.target.value)}>
              <option value="">Choose a bed…</option>
              {beds.map((bed) => (
                <option key={bed.id} value={String(bed.id)}>
                  {bed.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Type</span>
            <Select value={type} onChange={(e) => setType(e.target.value as CompostFertilizationLogCreate["type"])}>
              <option value="compost">Compost</option>
              <option value="fertilizer">Fertilizer</option>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Product</span>
              <Input placeholder="e.g. homemade compost" value={product} onChange={(e) => setProduct(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Amount</span>
              <Input placeholder="e.g. 2 wheelbarrows" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Date</span>
            <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="self-start" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Save log"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** One compost bin's own status row - inline-editable fill state/last-
 * turned/estimated-maturity/notes, committing a PATCH on change/blur (#39/
 * #223). */
function CompostBinRow({ bin, bedsById, onUpdated }: { bin: CompostBin; bedsById: Map<number, Bed>; onUpdated: (updated: CompostBin) => void }) {
  const mutation = useMutation({
    mutationFn: (patch: CompostBinUpdate) => updateCompostBin(bin.id as number, patch),
    onSuccess: onUpdated,
  });
  const [notesDraft, setNotesDraft] = useState(bin.notes);

  function commit(patch: CompostBinUpdate) {
    if (bin.id == null) return;
    mutation.mutate(patch);
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <span className="text-sm font-medium">{bedName(bedsById, bin.bed_id)}</span>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Fill state</span>
          <Select
            value={bin.fill_state}
            onChange={(e) => commit({ fill_state: e.target.value as CompostBin["fill_state"] })}
          >
            {FILL_STATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Last turned</span>
          <Input
            type="date"
            value={bin.last_turned_date ?? ""}
            onChange={(e) => commit({ last_turned_date: e.target.value || null })}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Estimated maturity</span>
        <Input
          type="date"
          value={bin.estimated_maturity_date ?? ""}
          onChange={(e) => commit({ estimated_maturity_date: e.target.value || null })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Notes</span>
        <Textarea
          rows={2}
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => notesDraft !== bin.notes && commit({ notes: notesDraft })}
        />
      </label>
    </div>
  );
}

/** Compost bin status at a glance, plus marking a bed as a compost bin in
 * the first place - only beds with a linked `CompostBin` row show status
 * UI (#223's own "a bed with no compost bin doesn't show bin-status UI"
 * requirement); every other bed is just a plain option in the "add a
 * compost bin" picker below. */
function CompostBinsSection({ beds, bins }: { beds: Bed[]; bins: CompostBin[] }) {
  const queryClient = useQueryClient();
  const [newBinBedId, setNewBinBedId] = useState("");
  const bedsById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b]));
  const bedIdsWithBins = new Set(bins.map((b) => b.bed_id));
  const availableBeds = beds.filter((b) => b.id != null && !bedIdsWithBins.has(b.id));

  const createMutation = useMutation({
    mutationFn: (bedId: number) => createCompostBin({ bed_id: bedId, fill_state: "empty", notes: "" }),
    onSuccess: (created) => {
      queryClient.setQueryData<CompostBin[]>(["compost-bins"], (old) => (old ? [...old, created] : [created]));
      setNewBinBedId("");
    },
  });

  function handleUpdated(updated: CompostBin) {
    queryClient.setQueryData<CompostBin[]>(["compost-bins"], (old) =>
      old ? old.map((b) => (b.id === updated.id ? updated : b)) : old,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Compost bins</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {bins.length === 0 && <p className="text-xs text-muted-foreground">No compost bins tracked yet.</p>}
        {bins.map((bin) => (
          <CompostBinRow key={bin.id} bin={bin} bedsById={bedsById} onUpdated={handleUpdated} />
        ))}

        {availableBeds.length > 0 && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Select
              className="flex-1"
              aria-label="Bed to mark as a compost bin"
              value={newBinBedId}
              onChange={(e) => setNewBinBedId(e.target.value)}
            >
              <option value="">Mark a bed as a compost bin…</option>
              {availableBeds.map((bed) => (
                <option key={bed.id} value={String(bed.id)}>
                  {bed.name}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!newBinBedId || createMutation.isPending}
              onClick={() => newBinBedId && createMutation.mutate(Number(newBinBedId))}
            >
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Most-recent-first list of logged compost/fertilization events, so the
 * form above reads as "actually saved something," not a form into the
 * void - same reasoning `TaskAgendaView.tsx` gives visible confirmation
 * for generated tasks. */
function RecentLogsList({ logs, bedsById }: { logs: CompostFertilizationLog[]; bedsById: Map<number, Bed> }) {
  const sorted = [...logs].sort((a, b) => b.log_date.localeCompare(a.log_date));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent logs</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sorted.slice(0, 20).map((log) => (
          <div key={log.id} className="text-sm">
            <span className="font-medium">{log.type === "compost" ? "Compost" : "Fertilizer"}</span>
            {" — "}
            {bedName(bedsById, log.bed_id)}
            <span className="block text-xs text-muted-foreground">
              {log.log_date}
              {log.product && ` · ${log.product}`}
              {log.amount && ` · ${log.amount}`}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** One open harvest task's own row - plant+bed label plus the shared
 * `HarvestLogDialog` trigger (#221). A flat list (no date-grouping) since
 * this is "log something now," not the due-date agenda `TaskAgendaView.tsx`
 * already covers. */
function HarvestTaskRow({
  action,
  bedsById,
  plantsBySlug,
  plantings,
}: {
  action: Action;
  bedsById: Map<number, Bed>;
  plantsBySlug: Map<string, Plant>;
  plantings: Planting[];
}) {
  const bed = action.bed_id != null ? bedsById.get(action.bed_id) : undefined;
  const plant = action.plant_slug ? plantsBySlug.get(action.plant_slug) : undefined;
  const { planting, matchCount } = resolveHarvestPlanting(plantings, action);

  return (
    <div className="flex items-center justify-between gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <span className="text-sm">
        <span className="font-medium">{plant?.common_name ?? action.plant_slug}</span>
        <span className="block text-xs text-muted-foreground">{bed?.name ?? `Bed #${action.bed_id}`}</span>
      </span>
      <HarvestLogDialog
        action={action}
        planting={planting}
        disabledReason={harvestDisabledReason(matchCount)}
        plantCommonName={plant?.common_name ?? action.plant_slug ?? "this plant"}
        bedName={bed?.name ?? `Bed #${action.bed_id}`}
        triggerLabel="Log harvest"
      />
    </div>
  );
}

/** Flat list of every pending `harvest` task, each opening the shared
 * `HarvestLogDialog` (#221) - the ticket's own required check that the
 * dialog works identically from this entry point, not just `TaskDetail`'s. */
function HarvestTasksSection({
  actions,
  bedsById,
  plantsBySlug,
  plantings,
}: {
  actions: Action[];
  bedsById: Map<number, Bed>;
  plantsBySlug: Map<string, Plant>;
  plantings: Planting[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Harvest</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {actions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No harvests to log right now - tasks with an open harvest window show up here.
          </p>
        )}
        {actions.map((action) => (
          <HarvestTaskRow
            key={action.id}
            action={action}
            bedsById={bedsById}
            plantsBySlug={plantsBySlug}
            plantings={plantings}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/** Compost/fertilization logging (#223) - product/amount/date/notes against
 * a bed, plus compost bin status tracking (fill state, last turned,
 * estimated maturity). Mobile-only per this ticket's own settled Platform
 * note (matches root CLAUDE.md's mobile route-set convention: logging is a
 * mobile-first quick action, no desktop equivalent required here). Harvest
 * logging (#221, `HarvestTasksSection` above) is this same tab's other
 * half - lives alongside this, not merged into it. */
export function MobileLogging() {
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const logsQuery = useQuery({ queryKey: ["compost-fertilization-logs"], queryFn: listCompostFertilizationLogs });
  const binsQuery = useQuery({ queryKey: ["compost-bins"], queryFn: listCompostBins });
  const harvestActionsQuery = useQuery({
    queryKey: ["actions", "harvest-pending"],
    queryFn: () => listActions({ status: "pending", actionType: "harvest" }),
  });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings });

  const beds = bedsQuery.data ?? [];
  const logs = logsQuery.data ?? [];
  const bins = binsQuery.data ?? [];
  const bedsById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b]));
  const plantsBySlug = new Map((plantsQuery.data ?? []).map((p) => [p.slug, p]));
  const harvestActions = harvestActionsQuery.data ?? [];
  const plantings = plantingsQuery.data ?? [];

  const isPending =
    bedsQuery.isPending ||
    logsQuery.isPending ||
    binsQuery.isPending ||
    harvestActionsQuery.isPending ||
    plantsQuery.isPending ||
    plantingsQuery.isPending;
  const isError =
    bedsQuery.isError ||
    logsQuery.isError ||
    binsQuery.isError ||
    harvestActionsQuery.isError ||
    plantsQuery.isError ||
    plantingsQuery.isError;

  return (
    <div className="flex flex-col gap-3">
      {/* text-base matches CardTitle's own size (16px) - see the "mobile
          page-heading pattern" backlog item, same convention every other
          mobile route already follows. */}
      <h1 className="text-base font-semibold">Logging</h1>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load.</p>}

      {!isPending && !isError && (
        <>
          <HarvestTasksSection
            actions={harvestActions}
            bedsById={bedsById}
            plantsBySlug={plantsBySlug}
            plantings={plantings}
          />
          <CompostLogForm beds={beds} />
          <CompostBinsSection beds={beds} bins={bins} />
          {logs.length > 0 && <RecentLogsList logs={logs} bedsById={bedsById} />}
        </>
      )}
    </div>
  );
}
