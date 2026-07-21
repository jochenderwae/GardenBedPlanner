import { useQueries, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlant, listSeedInventoryItems, type Plant, type PlantPeriod } from "@/api/client";
import { buildSeedGuideEntries, type SeedGuideEntry } from "./seedGuide";

const URGENCY_LABEL: Record<SeedGuideEntry["urgency"], string> = {
  buy: "Buy soon",
  sow: "Sow soon",
  ok: "OK",
};

const URGENCY_CLASSES: Record<SeedGuideEntry["urgency"], string> = {
  buy: "bg-destructive/10 text-destructive",
  sow: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ok: "bg-muted text-muted-foreground",
};

/** The seed buying guide/agenda-reminders view (see the "Seed buying guide"
 * backlog item) - cross-references `SeedInventoryItem` stock against each
 * plant's sowing window to flag "buy this soon" / "sow this soon" rows.
 * Shared between the desktop `/seed-guide` route and the mobile route
 * set's own tab, same as `AgendaView` - plain Tailwind/shadcn list UI, no
 * canvas-editor dependency that would need two separate implementations. */
export function SeedGuideView() {
  const itemsQuery = useQuery({ queryKey: ["seed-inventory-items"], queryFn: listSeedInventoryItems });
  const distinctSlugs = [...new Set((itemsQuery.data ?? []).map((item) => item.plant_slug))];

  // One fetch per distinct plant actually referenced by a seed inventory
  // row, not the whole plant database - only the single-plant PlantDetail
  // GET includes `periods` (see api/client.ts's PlantDetail doc).
  const plantQueries = useQueries({
    queries: distinctSlugs.map((slug) => ({ queryKey: ["plant", slug], queryFn: () => getPlant(slug) })),
  });

  const isPending = itemsQuery.isPending || plantQueries.some((q) => q.isPending);
  const isError = itemsQuery.isError || plantQueries.some((q) => q.isError);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading seed guide…</p>;
  if (isError) return <p className="text-sm text-destructive">Failed to load seed guide.</p>;

  const plantsBySlug = new Map<string, Plant>();
  const periodsBySlug = new Map<string, PlantPeriod[]>();
  for (const q of plantQueries) {
    if (!q.data) continue;
    plantsBySlug.set(q.data.slug, q.data);
    periodsBySlug.set(q.data.slug, q.data.periods);
  }

  const referenceMonth = new Date().getMonth() + 1;
  const entries = buildSeedGuideEntries(itemsQuery.data ?? [], plantsBySlug, periodsBySlug, referenceMonth);
  // "ok" entries (no sowing window approaching) are filtered out of the
  // default view - this is a reminder list, not a full inventory browser.
  // "buy" rows sort ahead of "sow" rows - needing to buy something is more
  // urgent than a reminder to use seeds already on hand.
  const URGENCY_RANK: Record<SeedGuideEntry["urgency"], number> = { buy: 0, sow: 1, ok: 2 };
  const actionable = entries
    .filter((entry) => entry.urgency !== "ok")
    .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);

  if (actionable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to buy or sow right now - seeds with an approaching sowing window will show up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {actionable.map((entry) => (
        <Card key={entry.plantSlug}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
            <CardTitle className="text-sm font-medium">{entry.plantCommonName}</CardTitle>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${URGENCY_CLASSES[entry.urgency]}`}>
              {URGENCY_LABEL[entry.urgency]}
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              {entry.hasStock ? "Seeds in stock - use them before the window closes." : "No seeds in stock yet."}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
