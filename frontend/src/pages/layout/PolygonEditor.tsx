import { useRef } from "react";
import type Konva from "konva";
import { Circle, Group, Line } from "react-konva";
import type { PolygonGeometry } from "@/api/client";

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
}: PolygonEditorProps) {
  const lineRef = useRef<Konva.Line>(null);
  const points = geometry.points;
  const showHandles = interactive && isSelected;

  function handleVertexDragMove(index: number, e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const newPoints = points.map((p, i) => (i === index ? { x: node.x(), y: node.y() } : p));
    lineRef.current?.points(flatten(newPoints));
    lineRef.current?.getLayer()?.batchDraw();
  }

  function handleVertexDragEnd(index: number, e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    onChange({ ...geometry, points: points.map((p, i) => (i === index ? { x: node.x(), y: node.y() } : p)) });
  }

  function handleShapeDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const dx = node.x();
    const dy = node.y();
    node.position({ x: 0, y: 0 });
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
        strokeWidth={isSelected ? 2.5 : 1.5}
        draggable={interactive}
        listening={interactive}
        onClick={onSelect}
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
            onDragMove={(e) => handleVertexDragMove(i, e)}
            onDragEnd={(e) => handleVertexDragEnd(i, e)}
            onDblClick={() => handleVertexRemove(i)}
          />
        ))}
    </Group>
  );
}
