import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import {
  createBedEquipment,
  createIrrigationZone,
  deleteBedEquipment,
  deleteIrrigationZone,
  getIrrigationZone,
  listIrrigationZones,
  updateBedEquipment,
  updateIrrigationZone,
  type Bed,
  type BedEquipment,
  type BedEquipmentCreate,
  type EquipmentCondition,
  type Garden,
  type IrrigationZone,
} from "@/api/client";
import { CONDITION_LABELS, ConditionBadge, UnplaceControl } from "./equipmentCondition";

/** Sentinel `<option>` value for "place in garden" in the same `<Select>`
 * that otherwise lists bed ids - kept distinct from any real bed id string
 * so `handlePlace` can branch on it (#207/#208). */
const PLACE_IN_GARDEN_VALUE = "__garden__";

export const DEFAULT_EQUIPMENT_SIZE_CM = 20;

interface EquipmentPanelProps {
  beds: Bed[];
  /** Needed for the "place in garden" option (#207/#208) - `null` while no
   * garden's been set up yet, in which case that option just isn't
   * offered. */
  garden: Garden | null;
  equipment: BedEquipment[];
  onClose: () => void;
  /** Place an inventory item onto a bed - lifted up to Layout.tsx (rather
   * than owning the geometry PATCH here) so the undo/redo history stack can
   * record it as one of its four tracked geometry-mutation sites. */
  onPlace: (item: BedEquipment, bed: Bed) => void;
  /** Place an inventory item directly against the garden as a whole
   * (#207/#208) - a rain barrel, pathway, or other item that doesn't belong
   * to any one bed. Same lifted-up-to-Layout.tsx reasoning as onPlace. */
  onPlaceInGarden: (item: BedEquipment) => void;
  /** Unplace a placed item back to inventory, recording its condition as of
   * that moment (#244, defaults "good" if the gardener doesn't change it in
   * `UnplaceControl`'s own picker) - same lifted-up-to-Layout.tsx reasoning
   * as onPlace. */
  onReturnToInventory: (item: BedEquipment, condition: EquipmentCondition) => void;
}

/** One irrigation zone's own row in the zone-management list (#200/#36):
 * an inline-editable name, its combined water delivery rate (fetched via
 * the zone's own detail endpoint - the list endpoint doesn't include it,
 * see `backend/app/api/routes/irrigation_zones.py`), and delete. Each row
 * owns its own detail query (rather than the parent panel fetching every
 * zone's detail up front) so a rename/delete doesn't need to touch every
 * other zone's data, and an equipment (re)assignment (see
 * `assignZoneMutation` below) only needs to invalidate the "irrigation-zone"
 * query prefix to refresh whichever totals actually changed. */
function ZoneRow({
  zone,
  onRename,
  onDelete,
}: {
  zone: IrrigationZone;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(zone.name);
  useEffect(() => setName(zone.name), [zone.name]);
  const detailQuery = useQuery({
    queryKey: ["irrigation-zone", zone.id],
    queryFn: () => getIrrigationZone(zone.id as number),
    enabled: zone.id != null,
  });
  const total = detailQuery.data?.total_water_delivery_lph;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Input
        className="h-7 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== zone.name && onRename(name.trim())}
      />
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
        {total != null ? `${total} L/h` : "—"}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete zone ${zone.name}`} onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  );
}

/** Zone list + create form (#200) - deliberately minimal (no separate
 * detail view/route): rename is inline on each `ZoneRow`, and a zone's
 * member equipment is managed from the *equipment* side (the "assign to
 * zone" `Select` on each placed item below), not from here. Deleting a zone
 * unassigns its member equipment server-side rather than deleting it (see
 * the backend route's own doc) - `onDeleted` invalidates `bed-equipment` so
 * those items' now-null `zone_id` is reflected without a full page reload. */
function ZoneManagementSection({
  zones,
  onCreated,
  onRenamed,
  onDeleted,
}: {
  zones: IrrigationZone[];
  onCreated: (zone: IrrigationZone) => void;
  onRenamed: (zone: IrrigationZone) => void;
  onDeleted: (id: number) => void;
}) {
  const [newZoneName, setNewZoneName] = useState("");

  const createMutation = useMutation({
    mutationFn: (name: string) => createIrrigationZone({ name, notes: null }),
    onSuccess: (created) => {
      onCreated(created);
      setNewZoneName("");
    },
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateIrrigationZone(id, { name }),
    onSuccess: onRenamed,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationZone(id),
    onSuccess: (_void, id) => onDeleted(id),
  });

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Irrigation zones
        <FieldHint description="Groups of drip-irrigation equipment whose combined water delivery is tracked together." />
      </h3>
      {zones.length === 0 && <p className="text-xs text-muted-foreground">No zones yet.</p>}
      <div className="flex flex-col gap-1">
        {zones.map((zone) => (
          <ZoneRow
            key={zone.id}
            zone={zone}
            onRename={(name) => zone.id != null && renameMutation.mutate({ id: zone.id, name })}
            onDelete={() => zone.id != null && deleteMutation.mutate(zone.id)}
          />
        ))}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newZoneName.trim()) return;
          createMutation.mutate(newZoneName.trim());
        }}
      >
        <Input
          placeholder="New zone name"
          className="h-7 flex-1"
          value={newZoneName}
          onChange={(e) => setNewZoneName(e.target.value)}
        />
        <Button type="submit" size="icon-sm" variant="outline" disabled={createMutation.isPending} aria-label="Add zone">
          <Plus />
        </Button>
      </form>
    </div>
  );
}

/** Trellises/drip lines/stakes/etc - equipment is "retrieved from stock,"
 * not authored ad hoc while editing a bed: the form here only ever creates
 * an unplaced inventory item (`bed_id: null`); placing one onto a bed (or
 * returning it to inventory) is a separate action on the item itself,
 * below. Deliberately form-based (type + optional height/water, a per-item
 * "place in bed" picker), not full drag/resize/rotate editing like beds/
 * plants get - see the redesign plan's note that this is the most minimal
 * of the placement tabs. Geometry, when placed, is bed-local (same
 * coordinate convention as Planting.geometry), auto-positioned the same
 * cascading way AddBedForm/the old inline form did. */
export function EquipmentPanel({ beds, garden, equipment, onClose, onPlace, onPlaceInGarden, onReturnToInventory }: EquipmentPanelProps) {
  const queryClient = useQueryClient();
  const [equipmentType, setEquipmentType] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [waterDeliveryLph, setWaterDeliveryLph] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (item: BedEquipmentCreate) => createBedEquipment(item),
    onSuccess: (created) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) => (old ? [...old, created] : [created]));
      setEquipmentType("");
      setHeightCm("");
      setWaterDeliveryLph("");
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to add equipment"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBedEquipment(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) => old?.filter((e) => e.id !== id));
    },
  });

  const zonesQuery = useQuery({ queryKey: ["irrigation-zones"], queryFn: listIrrigationZones });
  const zones = zonesQuery.data ?? [];

  const assignZoneMutation = useMutation({
    mutationFn: ({ id, zoneId }: { id: number; zoneId: number | null }) => updateBedEquipment(id, { zone_id: zoneId }),
    onSuccess: (updated) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) =>
        old ? old.map((e) => (e.id === updated.id ? updated : e)) : old,
      );
      // Whichever zone(s) this item just left/joined need their
      // total_water_delivery_lph recomputed - simplest correct approach for
      // a handful of zones is invalidating every zone-detail query rather
      // than tracking which specific zone id(s) changed.
      queryClient.invalidateQueries({ queryKey: ["irrigation-zone"] });
    },
  });

  function handleAssignZone(item: BedEquipment, zoneIdStr: string) {
    if (item.id == null) return;
    assignZoneMutation.mutate({ id: item.id, zoneId: zoneIdStr ? Number(zoneIdStr) : null });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!equipmentType.trim()) {
      setError("Type is required.");
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

  function handlePlace(item: BedEquipment, target: string) {
    if (item.id == null || !target) return;
    if (target === PLACE_IN_GARDEN_VALUE) {
      onPlaceInGarden(item);
      return;
    }
    const bed = beds.find((b) => String(b.id) === target);
    if (!bed || bed.id == null) return;
    onPlace(item, bed);
  }

  /** Where a placed item's own bed_id/garden_id says it lives - "Inventory"
   * only means genuinely unplaced (both null); a garden-bound item
   * (bed_id null, garden_id set) reads "Garden", not "Inventory" (#207/
   * #208). */
  function placementLabel(item: BedEquipment): string {
    if (item.bed_id != null) return beds.find((b) => b.id === item.bed_id)?.name ?? `Bed #${item.bed_id}`;
    if (item.garden_id != null) return garden?.name ?? "Garden";
    return "Inventory";
  }

  const inventory = equipment.filter((item) => item.bed_id == null && item.garden_id == null);
  const placed = equipment.filter((item) => item.bed_id != null || item.garden_id != null);

  return (
    <Card className="w-80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Equipment</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <form className="mb-4 flex flex-col gap-2 border-b pb-4" onSubmit={submit}>
        <p className="text-xs text-muted-foreground">Add to inventory - place it on a bed afterward.</p>
        {/* #213: explicit htmlFor/id on every field below - overrides the
            browser's implicit label-association algorithm entirely, so
            FieldHint's own <button> never steals it. */}
        <label className="flex flex-col gap-1" htmlFor="equipment-field-type">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Type
            <FieldHint description="Free-text equipment type, e.g. trellis, drip line, stake." />
          </span>
          <Input
            id="equipment-field-type"
            placeholder="e.g. trellis, drip line, stake..."
            value={equipmentType}
            onChange={(e) => setEquipmentType(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1" htmlFor="equipment-field-height">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Height (cm)
              <FieldHint description="How tall this equipment stands, in centimeters." />
            </span>
            <Input
              id="equipment-field-height"
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1" htmlFor="equipment-field-water">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Water (L/h)
              <FieldHint description="Water delivery rate in liters per hour, for irrigation equipment." />
            </span>
            <Input
              id="equipment-field-water"
              type="number"
              value={waterDeliveryLph}
              onChange={(e) => setWaterDeliveryLph(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Adding…" : "Add to inventory"}
        </Button>
      </form>

      <div className="flex flex-col gap-3">
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Inventory (unassigned)</h3>
          <div className="flex max-h-40 flex-col gap-1 overflow-auto">
            {inventory.length === 0 && <p className="text-xs text-muted-foreground">Nothing in stock.</p>}
            {inventory.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 rounded px-1 py-1 text-sm hover:bg-accent">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {item.equipment_type}
                    <ConditionBadge condition={item.condition} />
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${item.equipment_type}`}
                    onClick={() => item.id != null && deleteMutation.mutate(item.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {/* #244: a damaged/retired item isn't real "available
                    stock" - its condition badge above already says so, and
                    the placement picker itself is withheld rather than
                    silently letting the gardener place a broken item, per
                    this ticket's own functional requirement. Still listed
                    (and still deletable) so it stays visible/manageable. */}
                {item.condition === "good" ? (
                  <label className="flex items-center gap-1.5">
                    <PackageCheck className="size-3.5 shrink-0 text-muted-foreground" />
                    <Select
                      value=""
                      disabled={beds.length === 0 && !garden}
                      onChange={(e) => handlePlace(item, e.target.value)}
                    >
                      <option value="">Place in bed…</option>
                      {beds.map((bed) => (
                        <option key={bed.id} value={String(bed.id)}>
                          {bed.name}
                        </option>
                      ))}
                      {/* Garden-bound placement (#207/#208) - a rain barrel,
                          pathway, or other item that belongs to the garden as
                          a whole rather than to one bed. Always offered
                          alongside the bed list rather than gated by the
                          item's own equipment_type category - simpler, and
                          the category itself is only advisory (an item with
                          no matching EquipmentType has no category to check
                          against anyway). */}
                      {garden && <option value={PLACE_IN_GARDEN_VALUE}>Place in garden…</option>}
                    </Select>
                  </label>
                ) : (
                  <p className="text-xs text-muted-foreground">Not available to place - {CONDITION_LABELS[item.condition].toLowerCase()}.</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Placed</h3>
          <div className="flex max-h-40 flex-col gap-1 overflow-auto">
            {placed.length === 0 && <p className="text-xs text-muted-foreground">Nothing placed yet.</p>}
            {placed.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 rounded px-1 py-1 text-sm hover:bg-accent">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="inline-flex items-center gap-1.5 font-medium">
                      {item.equipment_type}
                      <ConditionBadge condition={item.condition} />
                    </div>
                    <div className="text-xs text-muted-foreground">{placementLabel(item)}</div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <UnplaceControl item={item} onReturnToInventory={onReturnToInventory} />
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
                <label className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs text-muted-foreground">Zone</span>
                  <Select
                    className="h-6 text-xs"
                    value={item.zone_id != null ? String(item.zone_id) : ""}
                    disabled={zones.length === 0}
                    onChange={(e) => handleAssignZone(item, e.target.value)}
                  >
                    <option value="">No zone</option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={String(zone.id)}>
                        {zone.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ZoneManagementSection
        zones={zones}
        onCreated={(created) =>
          queryClient.setQueryData<IrrigationZone[]>(["irrigation-zones"], (old) => (old ? [...old, created] : [created]))
        }
        onRenamed={(updated) =>
          queryClient.setQueryData<IrrigationZone[]>(["irrigation-zones"], (old) =>
            old ? old.map((z) => (z.id === updated.id ? updated : z)) : old,
          )
        }
        onDeleted={(id) => {
          queryClient.setQueryData<IrrigationZone[]>(["irrigation-zones"], (old) => old?.filter((z) => z.id !== id));
          queryClient.invalidateQueries({ queryKey: ["bed-equipment"] });
        }}
      />
    </Card>
  );
}
