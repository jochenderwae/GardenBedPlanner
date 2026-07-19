import { useEffect, useRef } from "react";
import { Group, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Bed, Geometry } from "@/api/client";
import { boundingRect, colorsForBedCategory, snapToGrid } from "./geometry";
import { PolygonEditor } from "./PolygonEditor";
import { DEFAULT_VIEWPORT, screenToWorld, worldToScreen, type Viewport } from "./viewport";

const MIN_SIZE_CM = 20;

interface BedNodeProps {
  bed: Bed;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (geometry: Geometry) => void;
  /** See PolygonEditor's own doc on this - gates drag/resize/rotate and
   * selection so a bed on a non-active tab renders but can't be nudged by
   * accident while the user is placing plants/equipment. */
  interactive?: boolean;
  /** Current `Stage` pan/zoom - needed because Konva's `dragBoundFunc`
   * receives the drag position in *absolute* (stage-container-pixel)
   * coordinates, not the node's local (world/cm) coordinates, so snapping
   * to the cm grid has to convert through the viewport first. Defaults to
   * the identity viewport for callers that don't pan/zoom. */
  viewport?: Viewport;
}

/** Rectangle path: drag/resize/rotate via Konva's Transformer. Polygon
 * path: delegates to PolygonEditor (shared with the Garden boundary) for
 * vertex-drag editing. */
export function BedNode({ bed, isSelected, onSelect, onChange, interactive = true, viewport = DEFAULT_VIEWPORT }: BedNodeProps) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const geometry = bed.border_geometry;

  useEffect(() => {
    if (interactive && isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [interactive, isSelected]);

  const colors = colorsForBedCategory(bed.category);

  if (geometry.type !== "rectangle") {
    const rect = boundingRect(geometry);
    return (
      <>
        <PolygonEditor
          geometry={geometry}
          isSelected={isSelected}
          onSelect={onSelect}
          onChange={onChange}
          fill={colors.fill}
          stroke={colors.stroke}
          interactive={interactive}
        />
        <Text x={rect.x + 4} y={rect.y + 4} text={bed.name} fontSize={12} fill="#1f2937" listening={false} />
      </>
    );
  }

  return (
    <>
      <Group>
        <Rect
          ref={shapeRef}
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
          rotation={geometry.rotation}
          fill={colors.fill}
          stroke={isSelected ? "#1d4ed8" : colors.stroke}
          strokeWidth={isSelected ? 2.5 : 1.5}
          draggable={interactive}
          listening={interactive}
          dragBoundFunc={(pos) => {
            const world = screenToWorld(pos, viewport);
            return worldToScreen({ x: snapToGrid(world.x), y: snapToGrid(world.y) }, viewport);
          }}
          onClick={onSelect}
          onTap={onSelect}
          onDragEnd={(e) =>
            onChange({ ...geometry, x: e.target.x(), y: e.target.y() })
          }
          onTransformEnd={() => {
            const node = shapeRef.current;
            if (!node) return;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            onChange({
              type: "rectangle",
              x: node.x(),
              y: node.y(),
              width: Math.max(MIN_SIZE_CM, Math.round(node.width() * scaleX)),
              height: Math.max(MIN_SIZE_CM, Math.round(node.height() * scaleY)),
              rotation: node.rotation(),
            });
          }}
        />
        <Text x={geometry.x + 4} y={geometry.y + 4} text={bed.name} fontSize={12} fill="#1f2937" listening={false} />
        {bed.has_greenhouse && (
          <Text
            x={geometry.x + 4}
            y={geometry.y + geometry.height - 16}
            text="greenhouse"
            fontSize={10}
            fill="#1f2937"
            opacity={0.7}
            listening={false}
          />
        )}
      </Group>
      {interactive && isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < MIN_SIZE_CM || newBox.height < MIN_SIZE_CM) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
}
