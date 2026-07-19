import type Konva from "konva";
import { useMemo } from "react";
import { Circle, Group, Layer, Rect, Text } from "react-konva";
import type { Bed, Geometry, Plant, Planting } from "@/api/client";
import { boundingRect, colorForSlug } from "./geometry";

export interface PickerState {
  bedId: number;
  /** bed-local coordinates (origin at the bed's own bounding-box top-left,
   * per docs/schema.md) - what Planting.geometry is always expressed in. */
  x: number;
  y: number;
  /** viewport coordinates, for positioning the HTML popover. */
  screenX: number;
  screenY: number;
}

interface PlantPlacementLayerProps {
  beds: Bed[];
  plantings: Planting[];
  plantsBySlug: Map<string, Plant>;
  active: boolean;
  onOpenPicker: (state: PickerState) => void;
  onMove: (planting: Planting, geometry: Geometry) => void;
  onDelete: (planting: Planting) => void;
}

/** Click an empty spot inside any bed (including the ground bed, so this
 * covers planting directly in open ground too) to open a plant picker -
 * Layout.tsx owns the picker's HTML popover and the create mutation, this
 * layer only reports where the click landed (see PickerState). Existing
 * plantings render as draggable colored dots, draggable/deletable only
 * while the Plants tab is active (the `active` prop - see Layout.tsx's tab
 * switcher, which is what satisfies the "locked while on another tab" ask
 * instead of a persisted DB field). */
export function PlantPlacementLayer({
  beds,
  plantings,
  plantsBySlug,
  active,
  onOpenPicker,
  onMove,
  onDelete,
}: PlantPlacementLayerProps) {
  const plantingsByBed = useMemo(() => {
    const map = new Map<number, Planting[]>();
    for (const planting of plantings) {
      const list = map.get(planting.bed_id) ?? [];
      list.push(planting);
      map.set(planting.bed_id, list);
    }
    return map;
  }, [plantings]);

  return (
    <Layer>
      {beds.map((bed) => {
        if (bed.id == null) return null;
        const rect = boundingRect(bed.border_geometry);
        const bedPlantings = plantingsByBed.get(bed.id) ?? [];
        return (
          <Group key={bed.id} x={rect.x} y={rect.y}>
            <Rect
              width={rect.width}
              height={rect.height}
              listening={active}
              onClick={(e) => {
                const pos = e.target.getRelativePointerPosition();
                const stageBox = e.target.getStage()?.container().getBoundingClientRect();
                if (!pos || !stageBox || bed.id == null) return;
                onOpenPicker({
                  bedId: bed.id,
                  x: pos.x,
                  y: pos.y,
                  screenX: stageBox.left + rect.x + pos.x,
                  screenY: stageBox.top + rect.y + pos.y,
                });
              }}
            />
            {bedPlantings.map((planting) => (
              <PlantingMarker
                key={planting.id}
                planting={planting}
                plant={plantsBySlug.get(planting.plant_slug)}
                active={active}
                onMove={(geometry) => onMove(planting, geometry)}
                onDelete={() => onDelete(planting)}
              />
            ))}
          </Group>
        );
      })}
    </Layer>
  );
}

function PlantingMarker({
  planting,
  plant,
  active,
  onMove,
  onDelete,
}: {
  planting: Planting;
  plant: Plant | undefined;
  active: boolean;
  onMove: (geometry: Geometry) => void;
  onDelete: () => void;
}) {
  const rect = boundingRect(planting.geometry);
  const radius = Math.max(4, rect.width / 2);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const color = colorForSlug(planting.plant_slug);

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    onMove({
      type: "rectangle",
      x: node.x() - rect.width / 2,
      y: node.y() - rect.height / 2,
      width: rect.width,
      height: rect.height,
      rotation: 0,
    });
  }

  return (
    <>
      <Circle
        x={centerX}
        y={centerY}
        radius={radius}
        fill={color}
        opacity={0.85}
        stroke="#00000040"
        strokeWidth={1}
        draggable={active}
        listening={active}
        onDragEnd={handleDragEnd}
        onDblClick={onDelete}
        onDblTap={onDelete}
      />
      {active && (
        <Text
          x={centerX + radius + 3}
          y={centerY - 5}
          text={plant?.common_name ?? planting.plant_slug}
          fontSize={10}
          fill="#1f2937"
          listening={false}
        />
      )}
    </>
  );
}
