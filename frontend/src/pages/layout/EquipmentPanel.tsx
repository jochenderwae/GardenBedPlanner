import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createBedEquipment,
  deleteBedEquipment,
  type Bed,
  type BedEquipment,
  type BedEquipmentCreate,
} from "@/api/client";

const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const DEFAULT_EQUIPMENT_SIZE_CM = 20;

interface EquipmentPanelProps {
  beds: Bed[];
  equipment: BedEquipment[];
  onClose: () => void;
}

/** Trellises/drip lines/stakes/etc - deliberately form-based (type + a
 * bed + optional basic geometry), not full drag/resize/rotate editing like
 * beds/plants get - see the redesign plan's note that this is the most
 * minimal of the three placement tabs. Geometry, when given, is bed-local
 * (same coordinate convention as Planting.geometry). */
export function EquipmentPanel({ beds, equipment, onClose }: EquipmentPanelProps) {
  const queryClient = useQueryClient();
  const [equipmentType, setEquipmentType] = useState("");
  const [bedId, setBedId] = useState<string>("");
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
    const bed = bedId ? beds.find((b) => String(b.id) === bedId) : undefined;
    // Cascading default position (same idea as AddBedForm's nextBedPosition)
    // so repeated adds to the same bed don't stack exactly on top of each
    // other - still just a starting point, no drag/resize in this tab.
    const existingInBed = bed?.id != null ? equipment.filter((e) => e.bed_id === bed.id).length : 0;
    const offset = (existingInBed % 5) * (DEFAULT_EQUIPMENT_SIZE_CM + 5);
    createMutation.mutate({
      bed_id: bed?.id ?? null,
      equipment_type: equipmentType.trim(),
      geometry: bed
        ? {
            type: "rectangle",
            x: 10 + offset,
            y: 10 + offset,
            width: DEFAULT_EQUIPMENT_SIZE_CM,
            height: DEFAULT_EQUIPMENT_SIZE_CM,
            rotation: 0,
          }
        : null,
      height_cm: heightCm ? Number(heightCm) : null,
      water_delivery_lph: waterDeliveryLph ? Number(waterDeliveryLph) : null,
    });
  }

  function bedName(id: number | null | undefined): string {
    if (id == null) return "Inventory (unassigned)";
    return beds.find((b) => b.id === id)?.name ?? `Bed #${id}`;
  }

  return (
    <Card className="w-80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Equipment</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <form className="mb-4 flex flex-col gap-2 border-b pb-4" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <input
            className={inputClass}
            placeholder="e.g. trellis, drip line, stake..."
            value={equipmentType}
            onChange={(e) => setEquipmentType(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Bed (optional - blank = inventory)</span>
          <select className={inputClass} value={bedId} onChange={(e) => setBedId(e.target.value)}>
            <option value="">— unassigned —</option>
            {beds.map((bed) => (
              <option key={bed.id} value={String(bed.id)}>
                {bed.name}
              </option>
            ))}
          </select>
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
          {createMutation.isPending ? "Adding…" : "Add equipment"}
        </Button>
      </form>

      <div className="flex max-h-72 flex-col gap-1 overflow-auto">
        {equipment.length === 0 && <p className="text-xs text-muted-foreground">No equipment yet.</p>}
        {equipment.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded px-1 py-1 text-sm hover:bg-accent">
            <div>
              <div className="font-medium">{item.equipment_type}</div>
              <div className="text-xs text-muted-foreground">{bedName(item.bed_id)}</div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${item.equipment_type}`}
              onClick={() => item.id != null && deleteMutation.mutate(item.id)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
