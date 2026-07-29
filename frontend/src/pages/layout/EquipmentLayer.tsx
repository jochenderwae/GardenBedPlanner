import { Group, Layer, Rect, Text } from "react-konva";
import type { Bed, BedEquipment, Garden } from "@/api/client";
import { boundingRect } from "./geometry";

interface EquipmentLayerProps {
  beds: Bed[];
  /** Garden-bound items (#207/#208 - `item.garden_id` set, `bed_id` null)
   * render nested inside the garden's own world offset the same way a
   * bed-bound item nests inside its bed's - `undefined`/no garden yet just
   * means nothing garden-bound can render (there's no offset to nest into,
   * same as a bed-bound item with no matching bed below). */
  garden?: Garden | null;
  equipment: BedEquipment[];
}

/** One equipment marker - a real-sized box (#208: the item's own `geometry`
 * width/height, already filled in from its `EquipmentType`'s
 * `default_geometry` at placement time - see `Layout.tsx`'s
 * `equipmentPlacementPatch` - rather than a fixed one-size-fits-all box),
 * nested at `x + itemRect.x, y + itemRect.y` inside whichever container
 * (bed or garden) it's local to. */
function EquipmentMarker({ x, y, item, geometry }: { x: number; y: number; item: BedEquipment; geometry: NonNullable<BedEquipment["geometry"]> }) {
  const itemRect = boundingRect(geometry);
  return (
    <Group x={x + itemRect.x} y={y + itemRect.y}>
      <Rect width={itemRect.width} height={itemRect.height} fill="#f59e0b55" stroke="#b45309" strokeWidth={1} />
      <Text x={2} y={itemRect.height + 2} text={item.equipment_type} fontSize={9} fill="#b45309" />
    </Group>
  );
}

/** Read-only markers for equipment that has a geometry and is placed
 * against either a bed or the garden as a whole - placement itself happens
 * through EquipmentPanel's form (see that file's comment on why this tab is
 * form-based, not drag/resize like beds/plants), so this layer never
 * listens for pointer events. */
export function EquipmentLayer({ beds, garden, equipment }: EquipmentLayerProps) {
  const bedsById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b]));
  const gardenRect = garden ? boundingRect(garden.border_geometry) : null;

  return (
    <Layer listening={false}>
      {equipment.map((item) => {
        if (item.geometry == null) return null;
        if (item.bed_id != null) {
          const bed = bedsById.get(item.bed_id);
          if (!bed) return null;
          const bedRect = boundingRect(bed.border_geometry);
          return <EquipmentMarker key={item.id} x={bedRect.x} y={bedRect.y} item={item} geometry={item.geometry} />;
        }
        if (item.garden_id != null && gardenRect) {
          return <EquipmentMarker key={item.id} x={gardenRect.x} y={gardenRect.y} item={item} geometry={item.geometry} />;
        }
        return null;
      })}
    </Layer>
  );
}
