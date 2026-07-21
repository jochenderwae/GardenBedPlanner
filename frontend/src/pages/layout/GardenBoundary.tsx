import { useEffect, useRef } from "react";
import { Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Geometry } from "@/api/client";
import { snapToGrid } from "./geometry";
import { PolygonEditor } from "./PolygonEditor";
import { DEFAULT_VIEWPORT, screenToWorld, worldToScreen, type Viewport } from "./viewport";

const MIN_SIZE_CM = 100;
const GARDEN_COLORS = { fill: "transparent", stroke: "#166534" };

interface GardenBoundaryProps {
  name: string;
  geometry: Geometry;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (geometry: Geometry) => void;
  /** Same tab-implied-locking mechanism as BedNode/PolygonEditor - the
   * garden outline still renders on the Equipment/Plants tabs for spatial
   * context, just non-interactively. */
  interactive?: boolean;
  /** See BedNode's identical prop doc - `dragBoundFunc` needs the current
   * pan/zoom to snap correctly. */
  viewport?: Viewport;
}

/** The overarching garden's own boundary - same rectangle-Transformer /
 * PolygonEditor split as BedNode, but drawn with no fill (beds sit inside
 * it and shouldn't be tinted by it). */
export function GardenBoundary({
  name,
  geometry,
  isSelected,
  onSelect,
  onChange,
  interactive = true,
  viewport = DEFAULT_VIEWPORT,
}: GardenBoundaryProps) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (interactive && isSelected && trRef.current && shapeRef.current && geometry.type === "rectangle") {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [interactive, isSelected, geometry.type]);

  if (geometry.type !== "rectangle") {
    return (
      <>
        <PolygonEditor
          geometry={geometry}
          isSelected={isSelected}
          onSelect={onSelect}
          onChange={onChange}
          fill={GARDEN_COLORS.fill}
          stroke={GARDEN_COLORS.stroke}
          interactive={interactive}
        />
        <Text x={geometry.points[0]?.x ?? 0} y={(geometry.points[0]?.y ?? 0) - 16} text={name} fontSize={12} fill="#166534" listening={false} />
      </>
    );
  }

  return (
    <>
      <Rect
        ref={shapeRef}
        x={geometry.x}
        y={geometry.y}
        width={geometry.width}
        height={geometry.height}
        rotation={geometry.rotation}
        fill={GARDEN_COLORS.fill}
        stroke={isSelected ? "#1d4ed8" : GARDEN_COLORS.stroke}
        strokeWidth={isSelected ? 2.5 : 2}
        dash={[6, 4]}
        draggable={interactive}
        listening={interactive}
        dragBoundFunc={(pos) => {
          const world = screenToWorld(pos, viewport);
          return worldToScreen({ x: snapToGrid(world.x), y: snapToGrid(world.y) }, viewport);
        }}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => onChange({ ...geometry, x: e.target.x(), y: e.target.y() })}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          // Grid-snap the resize result the same way the drag path already
          // does (see dragBoundFunc above) - see BedNode.tsx's identical fix
          // and the "grid-snap + alignment snapping" backlog item.
          onChange({
            type: "rectangle",
            x: snapToGrid(node.x()),
            y: snapToGrid(node.y()),
            width: Math.max(MIN_SIZE_CM, snapToGrid(Math.round(node.width() * scaleX))),
            height: Math.max(MIN_SIZE_CM, snapToGrid(Math.round(node.height() * scaleY))),
            rotation: node.rotation(),
          });
        }}
      />
      <Text x={geometry.x + 4} y={geometry.y - 16} text={name} fontSize={12} fill="#166534" listening={false} />
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
