import { useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Line, Text } from "react-konva";
import type { PolygonGeometry } from "@/api/client";
import { distanceBetweenPoints, formatDistanceCm, snapToGrid } from "./geometry";

const MIN_POINTS = 3;
const VERTEX_RADIUS = 5;

type Point = PolygonGeometry["points"][number];

interface PolygonEditorProps {
  geometry: PolygonGeometry;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (geometry: PolygonGeometry) => void;
  fill: string;
  stroke: string;
  /** Gates whole-shape drag, edge-insert, and vertex handles - the
   * mechanism behind tab-implied "locking" (see Layout.tsx's tab switcher):
   * a bed/garden boundary on a non-active tab renders but doesn't respond
   * to pointer input. Defaults true for callers that don't need locking. */
  interactive?: boolean;
  /** Doubles the shape's own outline strokeWidth - BedNode passes this for
   * a raised bed (height_cm > 0) as a visual difference in how the bed
   * itself is drawn, replacing a derived "Raised"/"Not raised" text label.
   * Not applicable to the Garden boundary (no height concept), so it's not
   * wired up by GardenBoundary and defaults false. */
  raised?: boolean;
}

function flatten(points: Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shared by Bed and Garden: a Konva.Line (closed) for the shape body -
 * draggable for whole-shape translate - plus one draggable Circle handle
 * per vertex for reshaping. Double-click an edge to insert a vertex there,
 * double-click a vertex to remove it (minimum 3 points enforced). Points
 * are in whatever coordinate space the caller renders this in (garden-space
 * for Bed/Garden borders, bed-local if ever nested for equipment) - this
 * component adds no transform of its own, so getRelativePointerPosition()
 * on the Line already lines up with the `points` array. */
export function PolygonEditor({
  geometry,
  isSelected,
  onSelect,
  onChange,
  fill,
  stroke,
  interactive = true,
  raised = false,
}: PolygonEditorProps) {
  const lineRef = useRef<Konva.Line>(null);
  const points = geometry.points;
  const showHandles = interactive && isSelected;

  // Live "distance to each neighboring vertex" readout while a vertex is
  // being dragged (simpler than a full running-area readout - see the
  // "Live dimension labels" backlog item's own note that precise per-edge
  // polygon dimensioning is a nice-to-have, not baseline, for now). Which
  // vertex is active is React state (set once per gesture, on start/end);
  // the two label positions/text update every drag tick via the same
  // imperative Konva ref + batchDraw pattern handleVertexDragMove already
  // uses for the line itself, not a React re-render per tick.
  const [activeVertexIndex, setActiveVertexIndex] = useState<number | null>(null);
  const prevDistTextRef = useRef<Konva.Text>(null);
  const nextDistTextRef = useRef<Konva.Text>(null);

  function handleVertexDragMove(index: number, e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const current = { x: node.x(), y: node.y() };
    const newPoints = points.map((p, i) => (i === index ? current : p));
    lineRef.current?.points(flatten(newPoints));

    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    prevDistTextRef.current?.position({ x: (current.x + prev.x) / 2, y: (current.y + prev.y) / 2 });
    prevDistTextRef.current?.text(formatDistanceCm(distanceBetweenPoints(current, prev)));
    nextDistTextRef.current?.position({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
    nextDistTextRef.current?.text(formatDistanceCm(distanceBetweenPoints(current, next)));

    lineRef.current?.getLayer()?.batchDraw();
  }

  function handleVertexDragEnd(index: number, e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    setActiveVertexIndex(null);
    // Grid-snap the vertex's final position - see BedNode.tsx's identical
    // snapToGrid usage; this path (and handleShapeDragEnd below) didn't
    // snap at all before (see the "grid-snap + alignment snapping" backlog
    // item), unlike BedNode's own rectangle drag.
    const snapped = { x: snapToGrid(node.x()), y: snapToGrid(node.y()) };
    onChange({ ...geometry, points: points.map((p, i) => (i === index ? snapped : p)) });
  }

  // Initial label position/text for the render that follows
  // setActiveVertexIndex (before the first drag-move tick updates the refs
  // imperatively) - null while no vertex is being dragged.
  const activeVertexLabels =
    activeVertexIndex != null
      ? (() => {
          const current = points[activeVertexIndex];
          const prev = points[(activeVertexIndex - 1 + points.length) % points.length];
          const next = points[(activeVertexIndex + 1) % points.length];
          return {
            prev: { x: (current.x + prev.x) / 2, y: (current.y + prev.y) / 2, text: formatDistanceCm(distanceBetweenPoints(current, prev)) },
            next: { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, text: formatDistanceCm(distanceBetweenPoints(current, next)) },
          };
        })()
      : null;

  function handleShapeDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const rawDx = node.x();
    const rawDy = node.y();
    node.position({ x: 0, y: 0 });
    // Grid-snap the whole-shape drag by snapping the first vertex's new
    // position and deriving the translation every point shares from that -
    // keeps the shape's own proportions intact (a plain per-point snap
    // could distort a non-axis-aligned polygon) while still landing the
    // dragged shape on the grid, matching BedNode's rectangle-drag snap.
    const anchor = points[0];
    const snappedAnchor = { x: snapToGrid(anchor.x + rawDx), y: snapToGrid(anchor.y + rawDy) };
    const dx = snappedAnchor.x - anchor.x;
    const dy = snappedAnchor.y - anchor.y;
    onChange({ ...geometry, points: points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
  }

  function handleVertexRemove(index: number) {
    if (points.length <= MIN_POINTS) return;
    onChange({ ...geometry, points: points.filter((_, i) => i !== index) });
  }

  function handleEdgeInsert(e: Konva.KonvaEventObject<MouseEvent>) {
    const pos = e.target.getRelativePointerPosition();
    if (!pos) return;
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = distanceToSegment(pos, points[i], points[(i + 1) % points.length]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    const newPoints = [...points];
    newPoints.splice(bestIndex + 1, 0, pos);
    onChange({ ...geometry, points: newPoints });
  }

  return (
    <Group>
      <Line
        ref={lineRef}
        points={flatten(points)}
        closed
        fill={fill}
        stroke={isSelected ? "#1d4ed8" : stroke}
        strokeWidth={(isSelected ? 2.5 : 1.5) * (raised ? 2 : 1)}
        draggable={interactive}
        listening={interactive}
        onClick={(e) => {
          // Same guard as BedNode.tsx's Rect onClick - Konva fires `click`
          // for any mouse button, not just left, so without this a
          // middle-mouse-drag that starts and ends over the shape (no
          // longer a Konva drag at all now that `dragButtons` excludes
          // button 1) would fall through to a plain "click" and select it.
          if (e.evt.button !== 0) return;
          onSelect();
        }}
        onTap={onSelect}
        onDblClick={handleEdgeInsert}
        onDragEnd={handleShapeDragEnd}
      />
      {showHandles &&
        points.map((p, i) => (
          <Circle
            key={i}
            x={p.x}
            y={p.y}
            radius={VERTEX_RADIUS}
            fill="#1d4ed8"
            stroke="#fff"
            strokeWidth={1}
            draggable
            onDragStart={() => setActiveVertexIndex(i)}
            onDragMove={(e) => handleVertexDragMove(i, e)}
            onDragEnd={(e) => handleVertexDragEnd(i, e)}
            onDblClick={() => handleVertexRemove(i)}
          />
        ))}
      {activeVertexLabels && (
        <>
          <Text
            ref={prevDistTextRef}
            x={activeVertexLabels.prev.x}
            y={activeVertexLabels.prev.y}
            text={activeVertexLabels.prev.text}
            fontSize={11}
            fill="#1d4ed8"
            listening={false}
          />
          <Text
            ref={nextDistTextRef}
            x={activeVertexLabels.next.x}
            y={activeVertexLabels.next.y}
            text={activeVertexLabels.next.text}
            fontSize={11}
            fill="#1d4ed8"
            listening={false}
          />
        </>
      )}
    </Group>
  );
}
