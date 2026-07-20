import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createBedEquipment,
  deleteBedEquipment,
  updateBedEquipment,
  type Bed,
  type BedEquipment,
  type BedEquipmentCreate,
  type BedEquipmentUpdate,
} from "@/api/client";

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const DEFAULT_EQUIPMENT_SIZE_CM = 20;

interface EquipmentPanelProps {
  beds: Bed[];
  equipment: BedEquipment[];
  onClose: () => void;
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
export function EquipmentPanel({ beds, equipment, onClose }: EquipmentPanelProps) {
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

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BedEquipmentUpdate }) => updateBedEquipment(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) =>
        old ? old.map((e) => (e.id === updated.id ? updated : e)) : old,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBedEquipment(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<BedEquipment[]>(["bed-equipment"], (old) => old?.filter((e) => e.id !== id));
    },
  });

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
    });
  }

  function handlePlace(item: BedEquipment, bedIdStr: string) {
    if (item.id == null || !bedIdStr) return;
    const bed = beds.find((b) => String(b.id) === bedIdStr);
    if (!bed || bed.id == null) return;
    // Cascading default position (same idea as AddBedForm's nextBedPosition)
    // so repeated placements into the same bed don't stack exactly on top
    // of each other - still just a starting point, no drag/resize in this
    // tab.
    const existingInBed = equipment.filter((e) => e.bed_id === bed.id).length;
    const offset = (existingInBed % 5) * (DEFAULT_EQUIPMENT_SIZE_CM + 5);
    updateMutation.mutate({
      id: item.id,
      patch: {
        bed_id: bed.id,
        geometry: {
          type: "rectangle",
          x: 10 + offset,
          y: 10 + offset,
          width: DEFAULT_EQUIPMENT_SIZE_CM,
          height: DEFAULT_EQUIPMENT_SIZE_CM,
          rotation: 0,
        },
      },
    });
  }

  function handleReturnToInventory(item: BedEquipment) {
    if (item.id == null) return;
    updateMutation.mutate({ id: item.id, patch: { bed_id: null, geometry: null } });
  }

  function bedName(id: number | null | undefined): string {
    if (id == null) return "Inventory";
    return beds.find((b) => b.id === id)?.name ?? `Bed #${id}`;
  }

  const inventory = equipment.filter((item) => item.bed_id == null);
  const placed = equipment.filter((item) => item.bed_id != null);

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
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <input
            className={inputClass}
            placeholder="e.g. trellis, drip line, stake..."
            value={equipmentType}
            onChange={(e) => setEquipmentType(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Height (cm)</span>
            <input
              type="number"
              className={inputClass}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Water (L/h)</span>
            <input
              type="number"
              className={inputClass}
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
                  <span className="font-medium">{item.equipment_type}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${item.equipment_type}`}
                    onClick={() => item.id != null && deleteMutation.mutate(item.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <label className="flex items-center gap-1.5">
                  <PackageCheck className="size-3.5 shrink-0 text-muted-foreground" />
                  <select
                    className={inputClass}
                    value=""
                    disabled={beds.length === 0}
                    onChange={(e) => handlePlace(item, e.target.value)}
                  >
                    <option value="">Place in bed…</option>
                    {beds.map((bed) => (
                      <option key={bed.id} value={String(bed.id)}>
                        {bed.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Placed</h3>
          <div className="flex max-h-40 flex-col gap-1 overflow-auto">
            {placed.length === 0 && <p className="text-xs text-muted-foreground">Nothing placed yet.</p>}
            {placed.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded px-1 py-1 text-sm hover:bg-accent">
                <div>
                  <div className="font-medium">{item.equipment_type}</div>
                  <div className="text-xs text-muted-foreground">{bedName(item.bed_id)}</div>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReturnToInventory(item)}
                    title="Return to inventory"
                  >
                    Unplace
                  </Button>
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
        </div>
      </div>
    </Card>
  );
}
