import { useEffect, useRef, useState } from "react";
import { Group, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Bed, Geometry, PolygonGeometry } from "@/api/client";
import {
  boundingRect,
  type Bounds,
  clampPointToBounds,
  clampRectPositionToBounds,
  colorsForBedCategory,
  formatDistanceCm,
  rectanglesOverlap,
  snapToGrid,
} from "./geometry";
import { PolygonEditor } from "./PolygonEditor";
import { DEFAULT_VIEWPORT, screenToWorld, worldToScreen, type Viewport } from "./viewport";

const MIN_SIZE_CM = 20;

// Konva's Transformer's handle sizes (anchorSize/anchorStrokeWidth/
// borderStrokeWidth/rotateAnchorOffset) are all specified in the same local
// coordinate space the Rect itself lives in, which - since this Rect sits
// directly under the Stage's own scaleX/scaleY (the pan/zoom this canvas
// added later, see the "Canvas pan/zoom" backlog item) - means they render
// at `value * viewport.scale` actual screen pixels: shrinking to
// near-invisible, hard-to-grab dots once the user zooms out to fit a garden
// bigger than the default view (a very likely real usage pattern), and
// oversized up close. Dividing each by `viewport.scale` below keeps them a
// constant ~10/50px on screen regardless of zoom - same values Konva
// defaults to, so this is a no-op at the Stage's default 100% zoom and only
// changes behavior away from it. Root cause of the "rotate handle isn't
// working/discoverable enough" report - the handle was always there, just
// unusably tiny whenever the garden required zooming out to see fully.
const TRANSFORMER_ANCHOR_SIZE_PX = 10;
const TRANSFORMER_ANCHOR_STROKE_WIDTH_PX = 1;
const TRANSFORMER_BORDER_STROKE_WIDTH_PX = 1;
const TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX = 50;

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
  /** Every *other* bed's bounding box (world/cm space) - when set, drag/
   * resize/vertex-drag on this bed is blocked from ending up overlapping
   * any of them (hard constraint, not a soft snap). Rectangle drag blocks
   * live (freezes at the last non-overlapping position); resize and the
   * polygon path reject the whole gesture and revert on overlap, since a
   * live partial-resize/partial-reshape push-out is out of scope here. */
  otherBedRects?: Bounds[];
}

/** Rectangle path: drag/resize/rotate via Konva's Transformer. Polygon
 * path: delegates to PolygonEditor (shared with the Garden boundary) for
 * vertex-drag editing. */
export function BedNode({
  bed,
  isSelected,
  onSelect,
  onChange,
  interactive = true,
  viewport = DEFAULT_VIEWPORT,
  bounds,
  otherBedRects,
}: BedNodeProps) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const lastValidPosRef = useRef<{ x: number; y: number } | null>(null);
  // Bumped to force PolygonEditor to remount (discarding whatever position a
  // rejected drag left its Konva nodes in) when a polygon-bed edit is
  // rejected for overlapping another bed - see handlePolygonChange below.
  const [polygonResetKey, setPolygonResetKey] = useState(0);
  // Live width x height readout shown only while a drag or resize gesture is
  // in progress (Konva's Transformer only reports the new size on
  // onTransformEnd otherwise - the known gap this fixes). Toggled via React
  // state on gesture start/end (fires once per gesture, cheap), but updated
  // on every move/transform tick via an imperative Konva ref + batchDraw
  // (same pattern PolygonEditor.tsx's handleVertexDragMove already uses for
  // live vertex feedback) rather than a React re-render per tick.
  const [showDimensions, setShowDimensions] = useState(false);
  const dimensionTextRef = useRef<Konva.Text>(null);
  const geometry = bed.border_geometry;

  useEffect(() => {
    if (interactive && isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [interactive, isSelected]);

  const colors = colorsForBedCategory(bed.category);
  // A raised bed (height_cm > 0) is drawn with roughly double the outline
  // strokeWidth instead of a derived "Raised"/"Not raised" text label (see
  // BedPanel.tsx, which dropped that label in favor of this) - a visual
  // difference in how the bed itself is drawn on the canvas.
  const isRaised = bed.height_cm > 0;

  if (geometry.type !== "rectangle") {
    const rect = boundingRect(geometry);
    function handlePolygonChange(next: PolygonGeometry) {
      const clamped = bounds ? { ...next, points: next.points.map((p) => clampPointToBounds(p, bounds)) } : next;
      const clampedRect = boundingRect(clamped);
      if (otherBedRects?.some((r) => rectanglesOverlap(clampedRect, r))) {
        setPolygonResetKey((k) => k + 1);
        return;
      }
      onChange(clamped);
    }
    return (
      <>
        <PolygonEditor
          key={polygonResetKey}
          geometry={geometry}
          isSelected={isSelected}
          onSelect={onSelect}
          onChange={handlePolygonChange}
          fill={colors.fill}
          stroke={colors.stroke}
          interactive={interactive}
          raised={isRaised}
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
          strokeWidth={(isSelected ? 2.5 : 1.5) * (isRaised ? 2 : 1)}
          draggable={interactive}
          listening={interactive}
          onDragStart={() => {
            lastValidPosRef.current = { x: geometry.x, y: geometry.y };
            setShowDimensions(true);
          }}
          onDragMove={(e) => {
            const node = e.target;
            dimensionTextRef.current?.position({ x: node.x(), y: node.y() - 16 / viewport.scale });
            // Width/height don't change during a plain move - re-set the
            // text anyway (cheap) so the label is consistent whichever
            // gesture (drag or resize) is currently showing it.
            dimensionTextRef.current?.text(`${formatDistanceCm(geometry.width)} × ${formatDistanceCm(geometry.height)}`);
            dimensionTextRef.current?.getLayer()?.batchDraw();
          }}
          dragBoundFunc={(pos) => {
            const world = screenToWorld(pos, viewport);
            let snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
            if (bounds) {
              snapped = clampRectPositionToBounds(snapped.x, snapped.y, geometry.width, geometry.height, bounds);
            }
            const candidateRect = { x: snapped.x, y: snapped.y, width: geometry.width, height: geometry.height };
            const overlaps = otherBedRects?.some((r) => rectanglesOverlap(candidateRect, r)) ?? false;
            if (overlaps) {
              // Freeze at the last non-overlapping position instead of
              // following the pointer further into another bed - a hard
              // constraint, not a soft snap. Falls back to the bed's own
              // current position if a gesture somehow starts overlapping.
              return worldToScreen(lastValidPosRef.current ?? { x: geometry.x, y: geometry.y }, viewport);
            }
            lastValidPosRef.current = snapped;
            return worldToScreen(snapped, viewport);
          }}
          onClick={onSelect}
          onTap={onSelect}
          onDragEnd={(e) => {
            setShowDimensions(false);
            onChange({ ...geometry, x: e.target.x(), y: e.target.y() });
          }}
          onTransformStart={() => setShowDimensions(true)}
          onTransform={() => {
            const node = shapeRef.current;
            if (!node) return;
            const width = Math.max(MIN_SIZE_CM, Math.round(node.width() * node.scaleX()));
            const height = Math.max(MIN_SIZE_CM, Math.round(node.height() * node.scaleY()));
            dimensionTextRef.current?.position({ x: node.x(), y: node.y() - 16 / viewport.scale });
            dimensionTextRef.current?.text(`${formatDistanceCm(width)} × ${formatDistanceCm(height)}`);
            dimensionTextRef.current?.getLayer()?.batchDraw();
          }}
          onTransformEnd={() => {
            setShowDimensions(false);
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
            const candidateRect = { x, y, width, height };
            if (otherBedRects?.some((r) => rectanglesOverlap(candidateRect, r))) {
              // Reject the resize entirely and snap the visible shape back
              // to its last known-good geometry - a live partial-resize
              // push-out isn't worth the complexity for a hard constraint.
              node.setAttrs({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: geometry.rotation });
              node.getLayer()?.batchDraw();
              return;
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
        {showDimensions && (
          <Text
            ref={dimensionTextRef}
            x={geometry.x}
            y={geometry.y - 16 / viewport.scale}
            text={`${formatDistanceCm(geometry.width)} × ${formatDistanceCm(geometry.height)}`}
            fontSize={12 / viewport.scale}
            fill="#1d4ed8"
            listening={false}
          />
        )}
      </Group>
      {interactive && isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={false}
          anchorSize={TRANSFORMER_ANCHOR_SIZE_PX / viewport.scale}
          anchorStrokeWidth={TRANSFORMER_ANCHOR_STROKE_WIDTH_PX / viewport.scale}
          borderStrokeWidth={TRANSFORMER_BORDER_STROKE_WIDTH_PX / viewport.scale}
          rotateAnchorOffset={TRANSFORMER_ROTATE_ANCHOR_OFFSET_PX / viewport.scale}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < MIN_SIZE_CM || newBox.height < MIN_SIZE_CM) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
}
