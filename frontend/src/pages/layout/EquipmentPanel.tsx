import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { FieldHint, Tooltip } from "@/components/ui/tooltip";
import {
  createBedEquipment,
  deleteBedEquipment,
  type Bed,
  type BedEquipment,
  type BedEquipmentCreate,
} from "@/api/client";

export const DEFAULT_EQUIPMENT_SIZE_CM = 20;

interface EquipmentPanelProps {
  beds: Bed[];
  equipment: BedEquipment[];
  onClose: () => void;
  /** Place an inventory item onto a bed - lifted up to Layout.tsx (rather
   * than owning the geometry PATCH here) so the undo/redo history stack can
   * record it as one of its four tracked geometry-mutation sites. */
  onPlace: (item: BedEquipment, bed: Bed) => void;
  /** Unplace a placed item back to inventory - same reasoning as onPlace. */
  onReturnToInventory: (item: BedEquipment) => void;
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
export function EquipmentPanel({ beds, equipment, onClose, onPlace, onReturnToInventory }: EquipmentPanelProps) {
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
    onPlace(item, bed);
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
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Type
            <FieldHint description="Free-text equipment type, e.g. trellis, drip line, stake." />
          </span>
          <Input
            placeholder="e.g. trellis, drip line, stake..."
            value={equipmentType}
            onChange={(e) => setEquipmentType(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Height (cm)
              <FieldHint description="How tall this equipment stands, in centimeters." />
            </span>
            <Input
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Water (L/h)
              <FieldHint description="Water delivery rate in liters per hour, for irrigation equipment." />
            </span>
            <Input
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
                  <Select
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
                  </Select>
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
                  <Tooltip content="Return to inventory">
                    <Button variant="ghost" size="sm" onClick={() => onReturnToInventory(item)}>
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
        </div>
      </div>
    </Card>
  );
}
