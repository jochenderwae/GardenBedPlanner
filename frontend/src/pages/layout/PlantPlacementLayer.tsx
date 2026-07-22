import type Konva from "konva";
import { useMemo, useState } from "react";
import { Group, Layer, Rect, Text } from "react-konva";
import type { Bed, Geometry, PlacementType, Plant, Planting } from "@/api/client";
import {
  boundingRect,
  colorForSlug,
  DEFAULT_PLANTING_DIAMETER_CM,
  fieldGeometryFromDrag,
  normalizedRect,
  rectanglesOverlap,
  rectRenderProps,
  rowGeometryFromDrag,
  snapToGrid,
} from "./geometry";
import { PlantFootprint } from "./PlantFootprint";

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
  /** Plain click on an existing marker opens its edit/details popup
   * (PlantingPanel, owned by Layout.tsx); shift-click (`additive: true`)
   * instead toggles that marker into/out of the multi-selection (see
   * `selectedIds`/`onMarqueeSelect` below) without opening anything - delete
   * lives inside PlantingPanel for a single planting, or BulkPlantingPanel
   * for a multi-selection. */
  onSelect: (planting: Planting, additive: boolean) => void;
  /** Ids of the plantings currently in the multi-selection (marquee-drag or
   * shift-click) - drawn with a highlighted stroke; dragging any one of them
   * while the selection has 2+ members moves the whole group together (see
   * Layout.tsx's handlePlantingMove). */
  selectedIds: Set<number>;
  /** Fired when a marquee (click-drag over empty bed space while no plant is
   * armed - see `canSelect` below) completes: every planting in that bed
   * whose bounding box intersects the drawn rectangle, plus whether it
   * should add to the existing selection (drag started with shift held) or
   * replace it outright (plain drag, including an empty/same-point drag -
   * the "click empty space to clear the selection" case). */
  onMarqueeSelect: (ids: number[], additive: boolean) => void;
}

/** Pick a plant first (Layout.tsx's toolbar), then draw where it goes:
 * single-click for a point placement, click-drag-release for a row (thin
 * rectangle along the drag line) or a field/area (the drawn rectangle
 * itself) - the three `Planting.placement_type` values the backend already
 * supports. Existing plantings render as draggable, click-to-edit markers
 * (matching how clicking a bed opens BedPanel - see `onSelect`), shaped by
 * their own placement type; drawing/dragging/selecting only responds while
 * the Plants tab is active (the `active` prop - see Layout.tsx's tab
 * switcher, the same "locked while on another tab" mechanism used for
 * beds). */
export function PlantPlacementLayer({
  beds,
  plantings,
  plantsBySlug,
  active,
  armedPlant,
  placementMode,
  onPlace,
  onMove,
  onSelect,
  selectedIds,
  onMarqueeSelect,
}: PlantPlacementLayerProps) {
  const [draw, setDraw] = useState<{ bedId: number; start: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null,
  );
  const [marquee, setMarquee] = useState<
    { bedId: number; start: { x: number; y: number }; current: { x: number; y: number }; additive: boolean } | null
  >(null);

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
  // No plant armed = selection mode: click-drag over empty bed space draws a
  // marquee instead of a placement (see handleMouseDown/Up below).
  const canSelect = active && armedPlant == null;
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
    const pos = localPoint(e);
    if (!pos) return;
    if (canDraw) {
      if (placementMode === "individual") return;
      setDraw({ bedId, start: pos, current: pos });
      return;
    }
    if (canSelect) {
      setMarquee({ bedId, start: pos, current: pos, additive: e.evt.shiftKey });
    }
  }

  function handleMouseMove(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    const pos = localPoint(e);
    if (!pos) return;
    if (draw && draw.bedId === bedId) {
      setDraw({ ...draw, current: pos });
      return;
    }
    if (marquee && marquee.bedId === bedId) setMarquee({ ...marquee, current: pos });
  }

  function handleMouseUp(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (draw && draw.bedId === bedId) {
      if (armedPlant) {
        const pos = localPoint(e) ?? draw.current;
        const geometry =
          placementMode === "row"
            ? rowGeometryFromDrag(draw.start, pos, thicknessCm)
            : fieldGeometryFromDrag(draw.start, pos);
        if (geometry) onPlace(bedId, geometry, placementMode);
      }
      setDraw(null);
      return;
    }
    if (marquee && marquee.bedId === bedId) {
      const pos = localPoint(e) ?? marquee.current;
      const marqueeRect = normalizedRect(marquee.start, pos);
      const bedPlantings = plantingsByBed.get(bedId) ?? [];
      const hitIds = bedPlantings
        .filter((p) => p.id != null && rectanglesOverlap(marqueeRect, boundingRect(p.geometry)))
        .map((p) => p.id as number);
      onMarqueeSelect(hitIds, marquee.additive);
      setMarquee(null);
    }
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
        const marqueeRect = marquee && marquee.bedId === bed.id ? normalizedRect(marquee.start, marquee.current) : null;
        return (
          <Group key={bed.id} x={rect.x} y={rect.y}>
            <Rect
              width={rect.width}
              height={rect.height}
              listening={canDraw || canSelect}
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
            {marqueeRect && (
              <Rect
                {...marqueeRect}
                fill="#2563eb1a"
                stroke="#2563eb"
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            )}
            {bedPlantings.map((planting) => (
              <PlantingMarker
                key={planting.id}
                planting={planting}
                plant={plantsBySlug.get(planting.plant_slug)}
                active={active}
                selected={planting.id != null && selectedIds.has(planting.id)}
                onMove={(geometry) => onMove(planting, geometry)}
                onSelect={(additive) => onSelect(planting, additive)}
              />
            ))}
          </Group>
        );
      })}
    </Layer>
  );
}

// Multi-selection highlight - same blue BedNode/GardenBoundary already use
// for their own single-selection state.
const SELECTION_HIGHLIGHT_COLOR = "#1d4ed8";

function PlantingMarker({
  planting,
  plant,
  active,
  selected,
  onMove,
  onSelect,
}: {
  planting: Planting;
  plant: Plant | undefined;
  active: boolean;
  /** Whether this marker is part of the current multi-selection (marquee-
   * drag or shift-click) - see PlantPlacementLayerProps.selectedIds. */
  selected: boolean;
  onMove: (geometry: Geometry) => void;
  /** `additive` is true for a shift-click (toggle membership in the
   * multi-selection) and false for a plain click (open the single-planting
   * edit panel instead) - see PlantPlacementLayerProps.onSelect. */
  onSelect: (additive: boolean) => void;
}) {
  const label = plant?.common_name ?? planting.plant_slug;
  const color = colorForSlug(planting.plant_slug);

  if (planting.placement_type === "row" || planting.placement_type === "field") {
    const props = rectRenderProps(planting.geometry);

    function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
      const node = e.target;
      // Grid-snap the drag's final position - see BedNode.tsx's identical
      // snapToGrid usage; planting drag didn't snap at all before (see the
      // "grid-snap + alignment snapping" backlog item).
      onMove({
        type: "rectangle",
        x: snapToGrid(node.x()),
        y: snapToGrid(node.y()),
        width: props.width,
        height: props.height,
        rotation: node.rotation(),
      });
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
          stroke={selected ? SELECTION_HIGHLIGHT_COLOR : color}
          strokeWidth={selected ? 3 : 1.5}
          draggable={active}
          listening={active}
          onDragEnd={handleDragEnd}
          onClick={(e) => onSelect(e.evt.shiftKey)}
          onTap={() => onSelect(false)}
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
      x: snapToGrid(node.x() - rect.width / 2),
      y: snapToGrid(node.y() - rect.height / 2),
      width: rect.width,
      height: rect.height,
      rotation: 0,
    });
  }

  return (
    <>
      <PlantFootprint
        growthHabit={plant?.growth_habit}
        x={centerX}
        y={centerY}
        radius={radius}
        fill={color}
        opacity={0.85}
        stroke={selected ? SELECTION_HIGHLIGHT_COLOR : "#00000040"}
        strokeWidth={selected ? 2.5 : 1}
        draggable={active}
        listening={active}
        onDragEnd={handleDragEnd}
        onClick={(e) => onSelect(e.evt.shiftKey)}
        onTap={() => onSelect(false)}
      />
      {active && (
        <Text x={centerX + radius + 3} y={centerY - 5} text={label} fontSize={10} fill="#1f2937" listening={false} />
      )}
    </>
  );
}
