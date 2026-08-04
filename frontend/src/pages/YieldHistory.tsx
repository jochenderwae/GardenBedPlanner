import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listHarvestLogs, listPlantings, listPlants, type HarvestQuality, type Plant } from "@/api/client";
import { buildYieldHistory, type YieldPlantGroup } from "@/pages/harvest/yieldHistory";

const HARVEST_QUALITY_LABELS: Record<HarvestQuality, string> = {
  poor: "Poor",
  fair: "Fair",
  good: "Good",
  excellent: "Excellent",
};

function formatHarvestDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PlantYieldCard({ group, plant }: { group: YieldPlantGroup; plant: Plant | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{plant?.common_name ?? group.plantSlug}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {group.years.map((year) => (
          <div key={year.year} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{year.year}</span>
              {year.unitTotals.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {year.unitTotals.map((t) => `${t.total} ${t.unit}`).join(", ")}
                  {" · "}
                  {year.entries.length} {year.entries.length === 1 ? "harvest" : "harvests"}
                </span>
              )}
              {year.unitTotals.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  {year.entries.length} {year.entries.length === 1 ? "harvest" : "harvests"} logged, no amount recorded
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-1 pl-3">
              {year.entries.map((log) => (
                <li key={log.id} className="text-xs text-muted-foreground">
                  {formatHarvestDate(log.harvest_date)}
                  {log.yield_amount != null && ` — ${log.yield_amount}${log.yield_unit ? ` ${log.yield_unit}` : ""}`}
                  {log.quality && ` — ${HARVEST_QUALITY_LABELS[log.quality]}`}
                  {log.notes && <span className="block italic">"{log.notes}"</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Past-season productivity review (#222) - "before planning a new season,
 * look back at how last year actually went" per this ticket's own source
 * (Dave's "Evaluate last year" journey step). Read-only aggregation over
 * every logged `HarvestLog` (#221), grouped by plant then by year via
 * `yieldHistory.ts`'s pure `buildYieldHistory` - computed client-side
 * given this app's realistic data volume (a single home garden's worth of
 * harvest logs), rather than a dedicated backend rollup route.
 *
 * Desktop-only, same as `PlantsDatabase.tsx` (the pattern this view
 * follows) - a season-planning-time review, not one of the mobile shell's
 * core logging/agenda/notifications trio, per the ticket's own settled
 * Platform note. */
export function YieldHistory() {
  const logsQuery = useQuery({ queryKey: ["harvest-logs"], queryFn: () => listHarvestLogs() });
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings });
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });

  const isPending = logsQuery.isPending || plantingsQuery.isPending || plantsQuery.isPending;
  const isError = logsQuery.isError || plantingsQuery.isError || plantsQuery.isError;

  const plantingsById = new Map((plantingsQuery.data ?? []).filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const plantsBySlug = new Map((plantsQuery.data ?? []).map((p) => [p.slug, p]));
  const groups = buildYieldHistory(logsQuery.data ?? [], plantingsById).sort((a, b) => {
    const nameA = plantsBySlug.get(a.plantSlug)?.common_name ?? a.plantSlug;
    const nameB = plantsBySlug.get(b.plantSlug)?.common_name ?? b.plantSlug;
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-xl font-medium">Yield history</h1>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load yield history.</p>}

      {!isPending && !isError && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No harvests logged yet - once you log some from a harvest task, they'll show up here grouped by plant and
          year.
        </p>
      )}

      {!isPending && !isError && groups.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <PlantYieldCard key={group.plantSlug} group={group} plant={plantsBySlug.get(group.plantSlug)} />
          ))}
        </div>
      )}
    </div>
  );
}
