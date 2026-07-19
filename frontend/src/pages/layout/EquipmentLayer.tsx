import { Group, Layer, Rect, Text } from "react-konva";
import type { Bed, BedEquipment } from "@/api/client";
import { boundingRect } from "./geometry";

interface EquipmentLayerProps {
  beds: Bed[];
  equipment: BedEquipment[];
}

/** Read-only markers for equipment that has both a bed and a geometry -
 * placement itself happens through EquipmentPanel's form (see that file's
 * comment on why this tab is form-based, not drag/resize like beds/plants),
 * so this layer never listens for pointer events. */
export function EquipmentLayer({ beds, equipment }: EquipmentLayerProps) {
  const bedsById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, b]));

  return (
    <Layer listening={false}>
      {equipment.map((item) => {
        if (item.bed_id == null || item.geometry == null) return null;
        const bed = bedsById.get(item.bed_id);
        if (!bed) return null;
        const bedRect = boundingRect(bed.border_geometry);
        const itemRect = boundingRect(item.geometry);
        return (
          <Group key={item.id} x={bedRect.x + itemRect.x} y={bedRect.y + itemRect.y}>
            <Rect
              width={itemRect.width}
              height={itemRect.height}
              fill="#f59e0b55"
              stroke="#b45309"
              strokeWidth={1}
            />
            <Text x={2} y={itemRect.height + 2} text={item.equipment_type} fontSize={9} fill="#b45309" />
          </Group>
        );
      })}
    </Layer>
  );
}
