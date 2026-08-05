import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listShoppingList, type ShoppingListItem } from "@/api/client";

/** One shortfall row - name + the matched catalog part number (when one
 * exists, #251's `IrrigationPartType.part_number` - falls back silently to
 * just the name otherwise, same "seeded lookup, graceful when absent"
 * precedent the backend's own docstring describes), quantity needed, and
 * any notes the backend attached (currently unused by either aggregator,
 * kept for forward-compatibility rather than dropped). Purely read-only -
 * see `ShoppingList`'s own doc for why no resolve action lives here. */
function ShoppingListRow({ item }: { item: ShoppingListItem }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <div className="inline-flex items-center gap-1.5 text-sm font-medium">
          {item.name}
          {item.part_number && <span className="font-mono text-xs text-muted-foreground">{item.part_number}</span>}
        </div>
        {item.notes && <div className="text-xs text-muted-foreground">{item.notes}</div>}
      </div>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
        need {item.quantity_needed}
      </span>
    </div>
  );
}

function ShoppingListSection({ title, items, emptyText }: { title: string; items: ShoppingListItem[]; emptyText: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {title} ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
        <div className="flex flex-col divide-y">
          {items.map((item) => (
            <ShoppingListRow key={`${item.category}-${item.source_id ?? item.type_key}`} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Shopping list view (#255/#270) - a read-only, top-level page listing
 * every current shortfall `GET /api/shopping-list` aggregates: irrigation
 * parts with more `IrrigationPartInstance` rows placed than
 * `IrrigationPart.quantity_on_hand` covers, and `BedEquipment` rows placed
 * with `owned: false`, grouped by `equipment_type` since several unowned
 * items of the same type collapse into one row. Deliberately no
 * create/edit/resolve affordance here - same "purely derived, resolve by
 * fixing the underlying data" precedent the seed-buying guide's own "need
 * to buy" view already sets (see that ticket's own technical analysis):
 * resolving an item means bumping the irrigation part's stock count (the
 * Pipe network dialog, reached from the Bed Planner's Equipment tab) or
 * marking equipment owned (this page's own `/equipment`), both via their
 * existing forms, not a new mutation added here.
 *
 * Desktop-only, no mobile route - irrigation parts and equipment management
 * have no mobile/PWA route today either (see `RootShell.tsx`'s mobile
 * branch), so this follows the same precedent `Equipment.tsx`/`GardenPlan.tsx`
 * already set rather than introducing a first mobile-reachable inventory
 * view here. */
export function ShoppingList() {
  const query = useQuery({ queryKey: ["shopping-list"], queryFn: listShoppingList });
  const items = query.data ?? [];
  const irrigationItems = items.filter((item) => item.category === "irrigation_part");
  const equipmentItems = items.filter((item) => item.category === "equipment");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-medium">Shopping list</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Everything currently short - irrigation parts with more placed than you have on hand, plus equipment you've
        planned but haven't bought yet. Resolve an item from the Pipe network dialog (irrigation parts) or the{" "}
        <span className="font-medium">Equipment</span> page (mark it owned), not here.
      </p>

      {query.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {query.isError && <p className="text-sm text-destructive">Failed to load the shopping list.</p>}

      {!query.isPending && !query.isError && (
        <div className="flex flex-col gap-4">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing to buy right now - every part and piece of equipment is covered.</p>
          )}
          {items.length > 0 && (
            <>
              <ShoppingListSection title="Irrigation parts" items={irrigationItems} emptyText="No irrigation parts short." />
              <ShoppingListSection title="Equipment" items={equipmentItems} emptyText="No equipment short." />
            </>
          )}
        </div>
      )}
    </div>
  );
}
