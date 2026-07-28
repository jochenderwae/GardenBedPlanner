import { useEffect, useRef } from "react";
import { Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Geometry } from "@/api/client";
import type { PlantingTooltipState } from "./PlantingTooltip";
import { boundingRect, snapToGrid } from "./geometry";
import { clampLabelYBelowRuler, LABEL_PADDING_CM, measureTextWidth } from "./labels";
import { PolygonEditor } from "./PolygonEditor";
import { DEFAULT_VIEWPORT, screenToWorld, worldToScreen, type Viewport } from "./viewport";

const MIN_SIZE_CM = 100;
const GARDEN_COLORS = { fill: "transparent", stroke: "#166534" };
const GARDEN_LABEL_FONT_SIZE = 12;

// Same Transformer setup as BedNode.tsx - see that file's own comment for
// the full explanation of why these are passed as plain, literal on-screen
// pixel values with no manual `/ viewport.scale` compensation (Konva's
// `Transformer` already renders at a constant size regardless of ambient
// zoom; #129 removed a previous manual division that was actually
// double-compensating and made the handles balloon/shrink with zoom
// instead of staying constant).
const TRANSFORMER_ANCHOR_SIZE_PX = 10;
const TRANSFORMER_ANCHOR_STROKE_WIDTH_PX = 1;
const TRANSFORMER_BORDER_STROKE_WIDTH_PX = 1;
const TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX = 50;

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
  /** See BedNode's identical prop doc - only fires while the garden name
   * label is actually ellipsis-truncated. */
  onHoverLabel?: (tooltip: PlantingTooltipState | null) => void;
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
  onHoverLabel,
}: GardenBoundaryProps) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (interactive && isSelected && trRef.current && shapeRef.current && geometry.type === "rectangle") {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [interactive, isSelected, geometry.type]);

  // Same width-clamp + truncation-gated hover tooltip as BedNode's own name
  // label (see #166) - the garden's own name is just as capable of running
  // into a neighboring bed's label or the ruler's tick-label row.
  const labelAvailableWidth = Math.max(0, boundingRect(geometry).width - 2 * LABEL_PADDING_CM);
  const isNameTruncated = measureTextWidth(name, GARDEN_LABEL_FONT_SIZE) > labelAvailableWidth;

  function showLabelTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isNameTruncated || !onHoverLabel) return;
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHoverLabel({ x: e.evt.clientX - stageBox.left, y: e.evt.clientY - stageBox.top, title: name, subtitle: "" });
  }

  function hideLabelTooltip() {
    onHoverLabel?.(null);
  }

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
        <Text
          x={geometry.points[0]?.x ?? 0}
          y={clampLabelYBelowRuler((geometry.points[0]?.y ?? 0) - 16, viewport)}
          text={name}
          width={labelAvailableWidth}
          wrap="none"
          ellipsis
          fontSize={GARDEN_LABEL_FONT_SIZE}
          fill="#166534"
          listening={isNameTruncated}
          onMouseEnter={showLabelTooltip}
          onMouseMove={showLabelTooltip}
          onMouseLeave={hideLabelTooltip}
        />
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
      <Text
        x={geometry.x + LABEL_PADDING_CM}
        y={clampLabelYBelowRuler(geometry.y - 16, viewport)}
        text={name}
        width={labelAvailableWidth}
        wrap="none"
        ellipsis
        fontSize={GARDEN_LABEL_FONT_SIZE}
        fill="#166534"
        listening={isNameTruncated}
        onMouseEnter={showLabelTooltip}
        onMouseMove={showLabelTooltip}
        onMouseLeave={hideLabelTooltip}
      />
      {interactive && isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < MIN_SIZE_CM || newBox.height < MIN_SIZE_CM) return oldBox;
            return newBox;
          }}
          anchorSize={TRANSFORMER_ANCHOR_SIZE_PX}
          anchorStrokeWidth={TRANSFORMER_ANCHOR_STROKE_WIDTH_PX}
          borderStrokeWidth={TRANSFORMER_BORDER_STROKE_WIDTH_PX}
          rotateAnchorOffset={TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX}
        />
      )}
    </>
  );
}
