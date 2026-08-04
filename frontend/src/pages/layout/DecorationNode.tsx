import { useEffect, useRef } from "react";
import { Group, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Decoration, Geometry, PolygonGeometry } from "@/api/client";
import { boundingRect, type Bounds, clampPointToBounds, clampRectPositionToBounds, snapToGrid } from "./geometry";
import { PolygonEditor } from "./PolygonEditor";
import { DEFAULT_VIEWPORT, screenToWorld, worldToScreen, type Viewport } from "./viewport";

const MIN_SIZE_CM = 10;
const LABEL_FONT_SIZE = 11;
// Fixed neutral outline regardless of the decoration's own fill color -
// same "label/stroke independent of the user-picked fill" reasoning
// EquipmentLayer.tsx's EquipmentMarker already applies to its own fixed
// stroke/label colors, so a light-colored decoration (e.g. "Warm white")
// doesn't disappear against the canvas background.
const STROKE_COLOR = "#57534e";
const LABEL_COLOR = "#1f2937";

// Same on-screen-constant-size Transformer handle values BedNode.tsx uses -
// see that file's own comment on why these are literal pixel values, not
// divided by viewport.scale.
const TRANSFORMER_ANCHOR_SIZE_PX = 10;
const TRANSFORMER_ANCHOR_STROKE_WIDTH_PX = 1;
const TRANSFORMER_BORDER_STROKE_WIDTH_PX = 1;
const TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX = 50;

interface DecorationNodeProps {
  decoration: Decoration;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (geometry: Geometry) => void;
  /** Gates drag/resize/rotate/vertex-editing and selection, same "only the
   * active tab's own object type responds to pointer input" convention
   * every other canvas layer uses - see BedNode's identical prop. */
  interactive?: boolean;
  viewport?: Viewport;
  /** The garden's own bounding box - clamps drag/resize/vertex-drag inside
   * it, same as BedNode. Deliberately no `otherBedRects`-style overlap
   * blocking against beds/other decorations - a decoration is cosmetic, not
   * a real space a planting could conflict with, so overlapping a bed (e.g.
   * a path running alongside one) is a legitimate layout, not an error. */
  bounds?: Bounds;
}

/** One decoration's own canvas render + interaction (#242) - a `Rect`/
 * `PolygonEditor` filled with the decoration's own `color`, `stroke` a fixed
 * neutral tint, and a `Text` label in a fixed dark color regardless of fill
 * (see `STROKE_COLOR`/`LABEL_COLOR` above). Full drag/resize/rotate (via
 * Konva's `Transformer`, rectangle path) or vertex editing (via the shared
 * `PolygonEditor`, polygon path) - deliberately simpler than `BedNode`'s own
 * rectangle path (no other-bed overlap blocking, no alignment snapping, no
 * live dimension readout while dragging) since none of those bed-specific
 * concerns apply to a purely cosmetic object; grid-snap and garden-bounds
 * clamping are kept since those are basic canvas-editor conventions every
 * placeable object shares. */
export function DecorationNode({
  decoration,
  isSelected,
  onSelect,
  onChange,
  interactive = true,
  viewport = DEFAULT_VIEWPORT,
  bounds,
}: DecorationNodeProps) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const lastValidPosRef = useRef<{ x: number; y: number } | null>(null);
  const geometry = decoration.border_geometry;

  useEffect(() => {
    if (interactive && isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [interactive, isSelected]);

  if (geometry.type !== "rectangle") {
    const rect = boundingRect(geometry);
    function handlePolygonChange(next: PolygonGeometry) {
      const clamped = bounds ? { ...next, points: next.points.map((p) => clampPointToBounds(p, bounds)) } : next;
      onChange(clamped);
    }
    return (
      <>
        <PolygonEditor
          geometry={geometry}
          isSelected={isSelected}
          onSelect={onSelect}
          onChange={handlePolygonChange}
          fill={decoration.color}
          stroke={STROKE_COLOR}
          interactive={interactive}
        />
        <Text
          x={rect.x + 4}
          y={rect.y + 4}
          text={decoration.name}
          fontSize={LABEL_FONT_SIZE}
          fill={LABEL_COLOR}
          listening={false}
        />
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
          fill={decoration.color}
          stroke={isSelected ? "#1d4ed8" : STROKE_COLOR}
          strokeWidth={isSelected ? 2.5 : 1.5}
          draggable={interactive}
          listening={interactive}
          dragBoundFunc={(pos) => {
            const world = screenToWorld(pos, viewport);
            let snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
            if (bounds) {
              snapped = clampRectPositionToBounds(snapped.x, snapped.y, geometry.width, geometry.height, bounds);
            }
            lastValidPosRef.current = snapped;
            return worldToScreen(snapped, viewport);
          }}
          onClick={(e) => {
            // Same guard as BedNode.tsx's Rect onClick - see that file's
            // own comment on why middle-mouse-drag needs this.
            if (e.evt.button !== 0) return;
            onSelect();
          }}
          onTap={onSelect}
          onDragEnd={(e) => {
            onChange({ ...geometry, x: e.target.x(), y: e.target.y() });
          }}
          onTransformEnd={() => {
            const node = shapeRef.current;
            if (!node) return;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            let width = Math.max(MIN_SIZE_CM, snapToGrid(Math.round(node.width() * scaleX)));
            let height = Math.max(MIN_SIZE_CM, snapToGrid(Math.round(node.height() * scaleY)));
            let x = snapToGrid(node.x());
            let y = snapToGrid(node.y());
            if (bounds) {
              width = Math.min(width, Math.max(MIN_SIZE_CM, bounds.width));
              height = Math.min(height, Math.max(MIN_SIZE_CM, bounds.height));
              ({ x, y } = clampRectPositionToBounds(x, y, width, height, bounds));
            }
            onChange({ type: "rectangle", x, y, width, height, rotation: node.rotation() });
          }}
        />
        <Text x={geometry.x + 4} y={geometry.y + 4} text={decoration.name} fontSize={LABEL_FONT_SIZE} fill={LABEL_COLOR} listening={false} />
      </Group>
      {interactive && isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={false}
          anchorSize={TRANSFORMER_ANCHOR_SIZE_PX}
          anchorStrokeWidth={TRANSFORMER_ANCHOR_STROKE_WIDTH_PX}
          borderStrokeWidth={TRANSFORMER_BORDER_STROKE_WIDTH_PX}
          rotateAnchorOffset={TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < MIN_SIZE_CM || newBox.height < MIN_SIZE_CM) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
}
