import { useQueries, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlant, listBeds, listPeriodTypes, listPlantings, type Plant, type PlantPeriod } from "@/api/client";
import { isPlantingActiveAsOf, todayIsoDate } from "@/pages/layout/plantingLifecycle";
import { applyPeriodTypeLabels, buildAgendaEntries, groupByMonth, MONTH_NAMES } from "./agendaMonths";

/** Sowing/harvest windows derived from the garden's active plantings,
 * overlaid on a month-by-month timeline (see the "Calendar view of
 * planting-derived actions" backlog item) - shared between the desktop
 * `/agenda` route and the mobile route set's own Agenda tab, since this is
 * plain Tailwind/shadcn list UI, not anything canvas-editor-specific that
 * would need two separate implementations. */
export function AgendaView() {
  const plantingsQuery = useQuery({ queryKey: ["plantings"], queryFn: listPlantings });
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const periodTypesQuery = useQuery({ queryKey: ["period-types"], queryFn: listPeriodTypes });

  const today = todayIsoDate();
  const activePlantings = (plantingsQuery.data ?? []).filter((p) => isPlantingActiveAsOf(p, today));
  const distinctSlugs = [...new Set(activePlantings.map((p) => p.plant_slug))];

  // Plant (list) omits periods - only the single-plant PlantDetail GET
  // includes them (see api/client.ts's PlantDetail doc) - so periods are
  // fetched per distinct plant actually in the ground, not per planting row
  // or for the whole plant database. useQueries (not one query per render)
  // keeps each plant cached/re-fetched independently as plantings change.
  const plantQueries = useQueries({
    queries: distinctSlugs.map((slug) => ({ queryKey: ["plant", slug], queryFn: () => getPlant(slug) })),
  });

  const isPending =
    plantingsQuery.isPending || bedsQuery.isPending || periodTypesQuery.isPending || plantQueries.some((q) => q.isPending);
  const isError =
    plantingsQuery.isError || bedsQuery.isError || periodTypesQuery.isError || plantQueries.some((q) => q.isError);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading agenda…</p>;
  if (isError) return <p className="text-sm text-destructive">Failed to load agenda.</p>;

  const plantsBySlug = new Map<string, Plant>();
  const periods: PlantPeriod[] = [];
  for (const q of plantQueries) {
    if (!q.data) continue;
    plantsBySlug.set(q.data.slug, q.data);
    periods.push(...q.data.periods);
  }
  const bedsById = new Map((bedsQuery.data ?? []).filter((b) => b.id != null).map((b) => [b.id as number, b]));
  const periodTypeLabelsByCode = new Map(
    (periodTypesQuery.data ?? []).map((pt) => [pt.code, pt.description || pt.code]),
  );

  const entries = applyPeriodTypeLabels(
    buildAgendaEntries(activePlantings, plantsBySlug, periods, bedsById, today),
    periodTypeLabelsByCode,
  );
  const byMonth = groupByMonth(entries);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing due yet - plantings with sowing/harvest windows will show up here once you have some.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {MONTH_NAMES.map((name, index) => {
        const month = index + 1;
        const monthEntries = byMonth.get(month) ?? [];
        if (monthEntries.length === 0) return null;
        return (
          <Card key={month}>
            <CardHeader>
              <CardTitle className="text-sm">{name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {monthEntries.map((entry, i) => (
                <p key={i} className="text-sm">
                  <span className="font-medium">{entry.plantCommonName}</span>
                  <span className="text-muted-foreground"> — {entry.periodTypeLabel} ({entry.bedName})</span>
                </p>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
