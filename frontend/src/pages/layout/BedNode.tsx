import { useEffect, useRef } from "react";
import { Group, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Bed, Geometry, PolygonGeometry } from "@/api/client";
import { boundingRect, type Bounds, clampPointToBounds, clampRectPositionToBounds, colorsForBedCategory, snapToGrid } from "./geometry";
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
  /** The garden's own bounding box (world/cm space) - when set, every
   * drag/resize/vertex-drag on this bed is clamped so it stays inside the
   * garden's boundary. Undefined when there's no garden set up yet (nothing
   * to contain within). See `clampPointToBounds`/`clampRectPositionToBounds`
   * for the bounding-box-approximation tradeoff this makes. */
  bounds?: Bounds;
}

/** Rectangle path: drag/resize/rotate via Konva's Transformer. Polygon
 * path: delegates to PolygonEditor (shared with the Garden boundary) for
 * vertex-drag editing. */
export function BedNode({ bed, isSelected, onSelect, onChange, interactive = true, viewport = DEFAULT_VIEWPORT, bounds }: BedNodeProps) {
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
    function handlePolygonChange(next: PolygonGeometry) {
      if (!bounds) {
        onChange(next);
        return;
      }
      onChange({ ...next, points: next.points.map((p) => clampPointToBounds(p, bounds)) });
    }
    return (
      <>
        <PolygonEditor
          geometry={geometry}
          isSelected={isSelected}
          onSelect={onSelect}
          onChange={handlePolygonChange}
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
            let snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
            if (bounds) {
              snapped = clampRectPositionToBounds(snapped.x, snapped.y, geometry.width, geometry.height, bounds);
            }
            return worldToScreen(snapped, viewport);
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
            let width = Math.max(MIN_SIZE_CM, Math.round(node.width() * scaleX));
            let height = Math.max(MIN_SIZE_CM, Math.round(node.height() * scaleY));
            let x = node.x();
            let y = node.y();
            if (bounds) {
              width = Math.min(width, Math.max(MIN_SIZE_CM, bounds.width));
              height = Math.min(height, Math.max(MIN_SIZE_CM, bounds.height));
              ({ x, y } = clampRectPositionToBounds(x, y, width, height, bounds));
            }
            onChange({ type: "rectangle", x, y, width, height, rotation: node.rotation() });
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
