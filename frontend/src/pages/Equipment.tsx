import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { FieldHint, Tooltip } from "@/components/ui/tooltip";
import {
  createBedEquipment,
  deleteBedEquipment,
  getGarden,
  listBedEquipment,
  listBeds,
  listEquipmentTypes,
  updateBedEquipment,
  type Bed,
  type BedEquipment,
  type BedEquipmentCreate,
  type BedEquipmentUpdate,
} from "@/api/client";
import { boundingRect } from "@/pages/layout/geometry";
import { DEFAULT_EQUIPMENT_SIZE_CM } from "@/pages/layout/EquipmentPanel";
import { findEquipmentType } from "@/pages/layout/equipmentTypes";

/** Sentinel `<option>` value for "place in garden" - mirrors
 * `EquipmentPanel.tsx`'s own `PLACE_IN_GARDEN_VALUE` (kept as a separate
 * constant here rather than importing that one, since it's a private detail
 * of that module, not exported). */
const PLACE_IN_GARDEN_VALUE = "__garden__";

/** A standalone, top-level equipment inventory page (#33) - reachable from
 * the main nav, not buried inside the Bed Planner's canvas editor. Follows
 * the same precedent `/plants` (`PlantsDatabase.tsx`) already sets relative
 * to the Layout editor's own "Plants" placement tab: same underlying data,
 * two different jobs (browsing/managing inventory vs. live canvas
 * placement). Desktop-only, no mobile route - matches `/plants`'s own
 * absence from `MobileShell.tsx`'s 5-tab set (browsing/managing inventory
 * isn't one of the mobile route set's core trio of logging/agenda/
 * notifications, see root CLAUDE.md's convention).
 *
 * Deliberately *not* a reuse of `EquipmentPanel.tsx` wholesale - that
 * component's `onPlace`/`onPlaceInGarden`/`onReturnToInventory` props are
 * lifted up to `Layout.tsx` specifically so canvas placement mutations get
 * recorded on the undo/redo history stack (`Layout.tsx`'s four tracked
 * geometry-mutation sites); a standalone page placing a single inventory
 * item doesn't need undo/redo the way live canvas dragging does. Instead
 * this page owns its own placement mutations directly, reusing the same
 * cascading-default-position math (`equipmentPlacementPatch` below mirrors
 * `Layout.tsx`'s own function of the same shape) via the shared
 * `boundingRect`/`findEquipmentType` helpers, and the same
 * `listBedEquipment`/`createBedEquipment`/`updateBedEquipment`/
 * `deleteBedEquipment` API calls and "Inventory (unassigned)"/"Placed"
 * grouping logic (#34) `EquipmentPanel` already uses - so placing an item
 * here actually sets its geometry (a sensible cascading default position,
 * editable afterward from the canvas editor) rather than silently
 * no-op'ing or redirecting away to `/layout` first. */
export function Equipment() {
  const queryClient = useQueryClient();
  const equipmentQuery = useQuery({ queryKey: ["bed-equipment"], queryFn: listBedEquipment });
  const bedsQuery = useQuery({ queryKey: ["beds"], queryFn: listBeds });
  const gardenQuery = useQuery({ queryKey: ["garden"], queryFn: getGarden });
  const equipmentTypesQuery = useQuery({ queryKey: ["equipment-types"], queryFn: listEquipmentTypes });

  const [equipmentType, setEquipmentType] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [waterDeliveryLph, setWaterDeliveryLph] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const equipment = equipmentQuery.data ?? [];
  const beds = bedsQuery.data ?? [];
  const garden = gardenQuery.data ?? null;
  const equipmentTypes = equipmentTypesQuery.data ?? [];

  const isPending = equipmentQuery.isPending || bedsQuery.isPending || gardenQuery.isPending || equipmentTypesQuery.isPending;
  const isError = equipmentQuery.isError || bedsQuery.isError || equipmentTypesQuery.isError;

  const createMutation = useMutation({
    mutationFn: (item: BedEquipmentCreate) => createBedEquipment(item),
    onSuccess: (created) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) => (old ? [...old, created] : [created]));
      setEquipmentType("");
      setHeightCm("");
      setWaterDeliveryLph("");
    },
    onError: (err: unknown) => setFormError(err instanceof Error ? err.message : "Failed to add equipment"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBedEquipment(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) => old?.filter((e) => e.id !== id));
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BedEquipmentUpdate }) => updateBedEquipment(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) =>
        old ? old.map((e) => (e.id === updated.id ? updated : e)) : old,
      );
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!equipmentType.trim()) {
      setFormError("Type is required.");
      return;
    }
    createMutation.mutate({
      bed_id: null,
      equipment_type: equipmentType.trim(),
      geometry: null,
      height_cm: heightCm ? Number(heightCm) : null,
      water_delivery_lph: waterDeliveryLph ? Number(waterDeliveryLph) : null,
      // Matches BedEquipmentCreate's own server-side default - a brand new
      // inventory item always starts in good condition, no condition-
      // picker UI in this quick "add to inventory" form (that's a separate
      // backlog item's job).
      condition: "good",
      // #255: this form is genuinely "I have this item in hand, add it to
      // inventory" - owned defaults true server-side too, but the field is
      // required on the wire type now, so it's spelled out explicitly here.
      // No owned/unowned toggle in this quick-add form (that's the shopping-
      // list feature's own UI surface, not this one).
      owned: true,
    });
  }

  /** Same cascading-default-position shape as `Layout.tsx`'s own
   * `equipmentPlacementPatch`/`handleEquipmentPlace`/
   * `handleEquipmentPlaceInGarden` (#207/#208) - a real `EquipmentType`
   * match sizes/heights the placement from its `default_geometry`/
   * `default_height_cm`, falling back to `DEFAULT_EQUIPMENT_SIZE_CM` for an
   * item with no matching type on file. */
  function placementPatch(item: BedEquipment): { width: number; height: number; height_cm?: number } {
    const matchedType = findEquipmentType(item.equipment_type, equipmentTypes);
    const size = matchedType ? boundingRect(matchedType.default_geometry) : { width: DEFAULT_EQUIPMENT_SIZE_CM, height: DEFAULT_EQUIPMENT_SIZE_CM };
    const heightPatch = item.height_cm == null && matchedType?.default_height_cm != null ? { height_cm: matchedType.default_height_cm } : {};
    return { width: size.width, height: size.height, ...heightPatch };
  }

  function placeInBed(item: BedEquipment, bed: Bed) {
    if (item.id == null || bed.id == null) return;
    const { width, height, height_cm } = placementPatch(item);
    const existingInBed = equipment.filter((e) => e.bed_id === bed.id).length;
    const offset = (existingInBed % 5) * (Math.max(width, height) + 5);
    patchMutation.mutate({
      id: item.id,
      patch: {
        bed_id: bed.id,
        garden_id: null,
        geometry: { type: "rectangle", x: 10 + offset, y: 10 + offset, width, height, rotation: 0 },
        ...(height_cm != null ? { height_cm } : {}),
      },
    });
  }

  function placeInGarden(item: BedEquipment) {
    if (item.id == null || garden?.id == null) return;
    const gardenId = garden.id;
    const { width, height, height_cm } = placementPatch(item);
    const existingInGarden = equipment.filter((e) => e.garden_id === gardenId).length;
    const offset = (existingInGarden % 5) * (Math.max(width, height) + 5);
    patchMutation.mutate({
      id: item.id,
      patch: {
        bed_id: null,
        garden_id: gardenId,
        geometry: { type: "rectangle", x: 10 + offset, y: 10 + offset, width, height, rotation: 0 },
        ...(height_cm != null ? { height_cm } : {}),
      },
    });
  }

  function returnToInventory(item: BedEquipment) {
    if (item.id == null) return;
    patchMutation.mutate({ id: item.id, patch: { bed_id: null, garden_id: null, geometry: null } });
  }

  function handlePlaceSelect(item: BedEquipment, target: string) {
    if (item.id == null || !target) return;
    if (target === PLACE_IN_GARDEN_VALUE) {
      placeInGarden(item);
      return;
    }
    const bed = beds.find((b) => String(b.id) === target);
    if (!bed || bed.id == null) return;
    placeInBed(item, bed);
  }

  /** Where a placed item's own bed_id/garden_id says it lives - "Inventory"
   * only means genuinely unplaced (both null); a garden-bound item reads
   * "Garden", not "Inventory" (#207/#208), same as `EquipmentPanel.tsx`'s
   * own `placementLabel`. */
  function placementLabel(item: BedEquipment): string {
    if (item.bed_id != null) return beds.find((b) => b.id === item.bed_id)?.name ?? `Bed #${item.bed_id}`;
    if (item.garden_id != null) return garden?.name ?? "Garden";
    return "Inventory";
  }

  const inventory = equipment.filter((item) => item.bed_id == null && item.garden_id == null);
  const placed = equipment.filter((item) => item.bed_id != null || item.garden_id != null);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-medium">Equipment</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Every trellis, drip line, stake, and other piece of equipment you own - placed or still in stock. Equipment is
        "retrieved from stock," not authored ad hoc while editing a bed: add it here, then place it on a bed or
        against the garden as a whole.
      </p>

      {isPending && <p className="text-sm text-muted-foreground">Loading equipment…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load equipment.</p>}

      {!isPending && !isError && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add to inventory</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3" onSubmit={submit}>
                {/* #213: explicit htmlFor/id - overrides the browser's
                    implicit label-association algorithm entirely, so
                    FieldHint's own <button> never steals it. */}
                <label className="flex flex-col gap-1" htmlFor="equipment-page-field-type">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    Type
                    <FieldHint description="Free-text equipment type, e.g. trellis, drip line, stake." />
                  </span>
                  <Input
                    id="equipment-page-field-type"
                    placeholder="e.g. trellis, drip line, stake..."
                    value={equipmentType}
                    onChange={(e) => setEquipmentType(e.target.value)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1" htmlFor="equipment-page-field-height">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      Height (cm)
                      <FieldHint description="How tall this equipment stands, in centimeters." />
                    </span>
                    <Input id="equipment-page-field-height" type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1" htmlFor="equipment-page-field-water">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      Water (L/h)
                      <FieldHint description="Water delivery rate in liters per hour, for irrigation equipment." />
                    </span>
                    <Input id="equipment-page-field-water" type="number" value={waterDeliveryLph} onChange={(e) => setWaterDeliveryLph(e.target.value)} />
                  </label>
                </div>
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <Button type="submit" size="sm" className="self-start" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Adding…" : "Add to inventory"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Inventory (unassigned)</CardTitle>
            </CardHeader>
            <CardContent>
              {inventory.length === 0 && <p className="text-sm text-muted-foreground">Nothing in stock.</p>}
              <div className="flex flex-col divide-y">
                {inventory.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-sm font-medium">
                      {item.equipment_type}
                      {item.height_cm != null && <span className="ml-2 text-xs text-muted-foreground">{item.height_cm} cm</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5">
                        <PackageCheck className="size-3.5 shrink-0 text-muted-foreground" />
                        <Select
                          className="h-7 text-xs"
                          value=""
                          disabled={beds.length === 0 && !garden}
                          onChange={(e) => handlePlaceSelect(item, e.target.value)}
                        >
                          <option value="">Place in bed…</option>
                          {beds.map((bed) => (
                            <option key={bed.id} value={String(bed.id)}>
                              {bed.name}
                            </option>
                          ))}
                          {garden && <option value={PLACE_IN_GARDEN_VALUE}>Place in garden…</option>}
                        </Select>
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${item.equipment_type}`}
                        onClick={() => item.id != null && deleteMutation.mutate(item.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Placed</CardTitle>
            </CardHeader>
            <CardContent>
              {placed.length === 0 && <p className="text-sm text-muted-foreground">Nothing placed yet.</p>}
              <div className="flex flex-col divide-y">
                {placed.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <div className="text-sm font-medium">{item.equipment_type}</div>
                      <div className="text-xs text-muted-foreground">{placementLabel(item)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip content="Return to inventory">
                        <Button variant="ghost" size="sm" onClick={() => returnToInventory(item)}>
                          Unplace
                        </Button>
                      </Tooltip>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${item.equipment_type}`}
                        onClick={() => item.id != null && deleteMutation.mutate(item.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
