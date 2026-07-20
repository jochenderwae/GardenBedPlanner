import type Konva from "konva";
import { useMemo, useState } from "react";
import { Circle, Group, Layer, Rect, Text } from "react-konva";
import type { Bed, Geometry, PlacementType, Plant, Planting } from "@/api/client";
import {
  boundingRect,
  colorForSlug,
  DEFAULT_PLANTING_DIAMETER_CM,
  fieldGeometryFromDrag,
  rectRenderProps,
  rowGeometryFromDrag,
} from "./geometry";

/** "individual" draws with a single click; "row"/"field" draw with a
 * click-drag-release gesture (see PlantPlacementLayer's mouse handlers
 * below) - matches `Planting.placement_type` exactly, just named for the
 * drawing gesture it maps to rather than the backend's own vocabulary. */
export type PlacementMode = PlacementType;

interface PlantPlacementLayerProps {
  beds: Bed[];
  plantings: Planting[];
  plantsBySlug: Map<string, Plant>;
  active: boolean;
  /** The plant currently "armed" for placement - drawing on the canvas is a
   * no-op until one is picked (see Layout.tsx's toolbar). */
  armedPlant: Plant | null;
  placementMode: PlacementMode;
  onPlace: (bedId: number, geometry: Geometry, placementType: PlacementType) => void;
  onMove: (planting: Planting, geometry: Geometry) => void;
  onDelete: (planting: Planting) => void;
}

/** Pick a plant first (Layout.tsx's toolbar), then draw where it goes:
 * single-click for a point placement, click-drag-release for a row (thin
 * rectangle along the drag line) or a field/area (the drawn rectangle
 * itself) - the three `Planting.placement_type` values the backend already
 * supports. Existing plantings render as draggable, double-click-to-delete
 * markers, shaped by their own placement type; drawing/dragging/deleting
 * only responds while the Plants tab is active (the `active` prop - see
 * Layout.tsx's tab switcher, the same "locked while on another tab"
 * mechanism used for beds). */
export function PlantPlacementLayer({
  beds,
  plantings,
  plantsBySlug,
  active,
  armedPlant,
  placementMode,
  onPlace,
  onMove,
  onDelete,
}: PlantPlacementLayerProps) {
  const [draw, setDraw] = useState<{ bedId: number; start: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null,
  );

  const plantingsByBed = useMemo(() => {
    const map = new Map<number, Planting[]>();
    for (const planting of plantings) {
      const list = map.get(planting.bed_id) ?? [];
      list.push(planting);
      map.set(planting.bed_id, list);
    }
    return map;
  }, [plantings]);

  const canDraw = active && armedPlant != null;
  const thicknessCm = armedPlant?.spread_cm ?? DEFAULT_PLANTING_DIAMETER_CM;

  function localPoint(e: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } | null {
    return e.target.getRelativePointerPosition();
  }

  function handleClick(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (!canDraw || placementMode !== "individual" || !armedPlant) return;
    const pos = localPoint(e);
    if (!pos) return;
    onPlace(
      bedId,
      {
        type: "rectangle",
        x: pos.x - thicknessCm / 2,
        y: pos.y - thicknessCm / 2,
        width: thicknessCm,
        height: thicknessCm,
        rotation: 0,
      },
      "individual",
    );
  }

  function handleMouseDown(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (!canDraw || placementMode === "individual") return;
    const pos = localPoint(e);
    if (!pos) return;
    setDraw({ bedId, start: pos, current: pos });
  }

  function handleMouseMove(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (!draw || draw.bedId !== bedId) return;
    const pos = localPoint(e);
    if (pos) setDraw({ ...draw, current: pos });
  }

  function handleMouseUp(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (!draw || draw.bedId !== bedId || !armedPlant) {
      setDraw(null);
      return;
    }
    const pos = localPoint(e) ?? draw.current;
    const geometry =
      placementMode === "row" ? rowGeometryFromDrag(draw.start, pos, thicknessCm) : fieldGeometryFromDrag(draw.start, pos);
    if (geometry) onPlace(bedId, geometry, placementMode);
    setDraw(null);
  }

  return (
    <Layer>
      {beds.map((bed) => {
        if (bed.id == null) return null;
        const rect = boundingRect(bed.border_geometry);
        const bedPlantings = plantingsByBed.get(bed.id) ?? [];
        const preview =
          draw && draw.bedId === bed.id
            ? placementMode === "row"
              ? rowGeometryFromDrag(draw.start, draw.current, thicknessCm)
              : fieldGeometryFromDrag(draw.start, draw.current)
            : null;
        return (
          <Group key={bed.id} x={rect.x} y={rect.y}>
            <Rect
              width={rect.width}
              height={rect.height}
              listening={canDraw}
              onClick={(e) => handleClick(bed.id as number, e)}
              onMouseDown={(e) => handleMouseDown(bed.id as number, e)}
              onMouseMove={(e) => handleMouseMove(bed.id as number, e)}
              onMouseUp={(e) => handleMouseUp(bed.id as number, e)}
            />
            {preview && (
              <Rect
                {...preview}
                fill={colorForSlug(armedPlant?.slug ?? "")}
                opacity={0.35}
                stroke={colorForSlug(armedPlant?.slug ?? "")}
                strokeWidth={1}
                listening={false}
              />
            )}
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
  const label = plant?.common_name ?? planting.plant_slug;
  const color = colorForSlug(planting.plant_slug);

  if (planting.placement_type === "row" || planting.placement_type === "field") {
    const props = rectRenderProps(planting.geometry);

    function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
      const node = e.target;
      onMove({ type: "rectangle", x: node.x(), y: node.y(), width: props.width, height: props.height, rotation: node.rotation() });
    }

    return (
      <>
        <Rect
          x={props.x}
          y={props.y}
          width={props.width}
          height={props.height}
          rotation={props.rotation}
          fill={color}
          opacity={0.5}
          stroke={color}
          strokeWidth={1.5}
          draggable={active}
          listening={active}
          onDragEnd={handleDragEnd}
          onDblClick={onDelete}
          onDblTap={onDelete}
        />
        {active && (
          <Text x={props.x + 4} y={props.y - 14} text={label} fontSize={10} fill="#1f2937" listening={false} />
        )}
      </>
    );
  }

  const rect = boundingRect(planting.geometry);
  const radius = Math.max(4, rect.width / 2);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

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
        <Text x={centerX + radius + 3} y={centerY - 5} text={label} fontSize={10} fill="#1f2937" listening={false} />
      )}
    </>
  );
}
