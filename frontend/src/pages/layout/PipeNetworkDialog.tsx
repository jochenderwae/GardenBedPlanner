import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type Konva from "konva";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { Plus, Trash2, Waypoints, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createIrrigationConnection,
  createIrrigationPart,
  createIrrigationPartInstance,
  deleteIrrigationConnection,
  deleteIrrigationPart,
  deleteIrrigationPartInstance,
  listIrrigationConnections,
  listIrrigationPartInstances,
  listIrrigationParts,
  updateIrrigationPart,
  updateIrrigationPartInstance,
  type IrrigationConnection,
  type IrrigationPart,
  type IrrigationPartInstance,
} from "@/api/client";
import { snapToGrid } from "./geometry";
import { useContainerSize } from "./useContainerSize";

// See #209's design spec (that issue's own comment thread) for the full
// interaction/visual rationale behind every constant/decision below. #254/
// #268: `IrrigationPart` is catalog-only stock now - each diagram node is an
// independently-placed `IrrigationPartInstance` of a part, so a part owned
// in quantity > 1 can have several nodes, each with its own connections.

const NODE_WIDTH = 120;
const NODE_HEIGHT = 56;
// A coarser snap than the real garden canvas's DRAG_SNAP_CM (10) - this is
// a schematic diagram, not to-scale, so a coarser grid reads fine.
const DIAGRAM_GRID_SNAP_PX = 20;
// Deliberately distinct from equipment's amber, bed/vertex-selection blue,
// and the destructive red below, so this diagram reads as its own visual
// layer/vocabulary rather than a reskin of EquipmentMarker.
const NODE_STROKE = "#0891b2";
// The same hardcoded red CompassWidget.tsx already uses in a Konva layer -
// reused rather than picking a new one.
const NODE_NEEDS_PURCHASE_STROKE = "#dc2626";
const MISMATCH_LABEL_COLOR = "#d97706";
const CASCADE_STEP_PX = 40;

type Position = { x: number; y: number };

/** Where a ray from a rect's own center, in direction (dx, dy), exits that
 * rect's axis-aligned border - draws connection edges border-to-border
 * instead of center-to-center through the node bodies. */
function rectBorderIntersection(cx: number, cy: number, halfW: number, halfH: number, dx: number, dy: number): Position {
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** A point on a `width`x`height` rectangle's own perimeter, `t` the
 * fractional distance clockwise from top-middle (t=0) - spaces anchor
 * points evenly around a node's border regardless of its aspect ratio.
 * Returned relative to the rect's own center. */
function pointOnRectPerimeter(width: number, height: number, t: number): Position {
  const halfW = width / 2;
  const halfH = height / 2;
  const perimeter = 2 * (width + height);
  let d = (((t % 1) + 1) % 1) * perimeter;
  const topRight = width / 2;
  if (d <= topRight) return { x: d, y: -halfH };
  d -= topRight;
  if (d <= height) return { x: halfW, y: -halfH + d };
  d -= height;
  if (d <= width) return { x: halfW - d, y: halfH };
  d -= width;
  if (d <= height) return { x: -halfW, y: halfH - d };
  d -= height;
  return { x: -halfW + d, y: -halfH };
}

/** Always at least 2, one more than however many connections already use
 * this node, capped at 6 - "always exactly one more anchor showing than is
 * currently in use," per #209's design spec, without ever forcing a fixed
 * port count on a free-text part type. */
function anchorCountFor(connectionCount: number): number {
  return Math.min(6, Math.max(2, connectionCount + 1));
}

function nextCascadePosition(index: number): Position {
  const offset = (index % 8) * CASCADE_STEP_PX;
  return { x: 100 + offset, y: 80 + offset };
}

/** Groups connections by their unordered instance-id pair so duplicate
 * connections between the same two instances (legitimate - each is one
 * physical joint) can be rendered as distinct bowed lines instead of
 * perfectly overlapping. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

interface AddPartFormState {
  name: string;
  partType: string;
  quantityOnHand: string;
}

const PART_TYPE_SUGGESTIONS = ["nozzle", "t_junction", "connector", "valve", "hose_segment", "micro_tube", "end_cap", "dripper", "stake"];

/** One row in the left-panel parts catalog (#209/#254) - name/type, inline-
 * editable connector size + quantity (blur-to-save, same UX
 * `EquipmentPanel.tsx`'s `ZoneRow` name field already uses), a "needs
 * purchase" pill (reusing #41's `URGENCY_CLASSES.buy` class string
 * verbatim) driven by how many instances of this part are already placed
 * vs `quantity_on_hand`, an "Add instance to diagram" action (#254/#268: a
 * part can have several independently-placed physical units, so this is an
 * always-available add action, not a single add/toggle), and delete. */
function PartRow({
  part,
  instanceCount,
  isSelected,
  onAddInstance,
  onUpdateField,
  onDelete,
  rowRef,
}: {
  part: IrrigationPart;
  instanceCount: number;
  isSelected: boolean;
  onAddInstance: () => void;
  onUpdateField: (patch: { connector_size_mm?: number | null; quantity_on_hand?: number }) => void;
  onDelete: () => void;
  rowRef: (node: HTMLDivElement | null) => void;
}) {
  const [connectorSize, setConnectorSize] = useState(part.connector_size_mm != null ? String(part.connector_size_mm) : "");
  const [quantity, setQuantity] = useState(String(part.quantity_on_hand));
  useEffect(() => setConnectorSize(part.connector_size_mm != null ? String(part.connector_size_mm) : ""), [part.connector_size_mm]);
  useEffect(() => setQuantity(String(part.quantity_on_hand)), [part.quantity_on_hand]);

  const needsPurchase = instanceCount > part.quantity_on_hand;

  return (
    <div ref={rowRef} className={`flex flex-col gap-1 rounded px-1.5 py-1.5 text-sm ${isSelected ? "bg-accent" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium">{part.name}</div>
          <div className="text-xs text-muted-foreground">{part.part_type}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${part.name}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      {needsPurchase && (
        <span className="w-fit rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Needs purchase · have {part.quantity_on_hand}, need {instanceCount}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          className="h-6 w-16 text-xs"
          type="number"
          placeholder="mm"
          value={connectorSize}
          onChange={(e) => setConnectorSize(e.target.value)}
          onBlur={() => {
            const next = connectorSize.trim() === "" ? null : Number(connectorSize);
            if (next !== part.connector_size_mm) onUpdateField({ connector_size_mm: next });
          }}
        />
        <Input
          className="h-6 w-14 text-xs"
          type="number"
          placeholder="qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={() => {
            const next = Number(quantity);
            if (!Number.isNaN(next) && next !== part.quantity_on_hand) onUpdateField({ quantity_on_hand: next });
          }}
        />
        <Button variant="secondary" size="xs" className="ml-auto" onClick={onAddInstance}>
          <Plus /> Add instance{instanceCount > 0 ? ` (${instanceCount} on diagram)` : ""}
        </Button>
      </div>
    </div>
  );
}

/** One placed instance's node on the diagram canvas (#209/#254) - a rounded
 * rect showing the owning part's name/type/quantity (looked up via
 * `instance.part_id`), plus evenly-spaced anchor circles around its border
 * (see `anchorCountFor`): filled for an anchor already backing a
 * connection, hollow for the one spare "next connection" point, which is
 * also the only valid connection-drag start (`onAnchorDragStart`).
 * `needsPurchase` reflects the owning part's placed-instance-count vs
 * quantity_on_hand, not anything about this node individually - every
 * instance of an over-placed part shows the same flag. */
function PartNode({
  part,
  position,
  connectionCount,
  needsPurchase,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onAnchorMouseDown,
}: {
  part: IrrigationPart;
  position: Position;
  connectionCount: number;
  needsPurchase: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDragMove: (pos: Position) => void;
  onDragEnd: (pos: Position) => void;
  onAnchorMouseDown: (anchorAbsolutePos: Position) => void;
}) {
  const stroke = needsPurchase ? NODE_NEEDS_PURCHASE_STROKE : NODE_STROKE;
  const anchorCount = anchorCountFor(connectionCount);
  const filledCount = Math.min(connectionCount, anchorCount);
  const anchors = Array.from({ length: anchorCount }, (_, i) => ({
    ...pointOnRectPerimeter(NODE_WIDTH, NODE_HEIGHT, i / anchorCount),
    hollow: i >= filledCount,
  }));

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onClick={(e) => {
        if (e.evt.button !== 0) return;
        onSelect();
      }}
      onDragMove={(e) => onDragMove({ x: e.target.x(), y: e.target.y() })}
      onDragEnd={(e) => onDragEnd({ x: snapToGrid(e.target.x(), DIAGRAM_GRID_SNAP_PX), y: snapToGrid(e.target.y(), DIAGRAM_GRID_SNAP_PX) })}
    >
      <Rect
        x={-NODE_WIDTH / 2}
        y={-NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        cornerRadius={6}
        fill="#ffffff"
        stroke={stroke}
        strokeWidth={isSelected ? 2.5 : 1.5}
      />
      <Text
        x={-NODE_WIDTH / 2 + 6}
        y={-NODE_HEIGHT / 2 + 6}
        width={NODE_WIDTH - 12}
        text={part.name}
        fontSize={11}
        fill="#0f172a"
        wrap="word"
        listening={false}
      />
      <Text
        x={-NODE_WIDTH / 2 + 6}
        y={NODE_HEIGHT / 2 - 16}
        width={NODE_WIDTH - 30}
        text={part.part_type}
        fontSize={9}
        fill="#64748b"
        listening={false}
      />
      <Text
        x={NODE_WIDTH / 2 - 26}
        y={NODE_HEIGHT / 2 - 16}
        width={22}
        align="right"
        text={`×${part.quantity_on_hand}`}
        fontSize={10}
        fill="#64748b"
        listening={false}
      />
      {needsPurchase && (
        <>
          <Circle x={NODE_WIDTH / 2 - 4} y={-NODE_HEIGHT / 2 + 4} radius={6} fill={NODE_NEEDS_PURCHASE_STROKE} listening={false} />
          <Text
            x={NODE_WIDTH / 2 - 8}
            y={-NODE_HEIGHT / 2}
            width={8}
            align="center"
            text="!"
            fontSize={9}
            fontStyle="bold"
            fill="#ffffff"
            listening={false}
          />
        </>
      )}
      {anchors.map((anchor, i) => (
        <Circle
          key={i}
          x={anchor.x}
          y={anchor.y}
          radius={4}
          stroke={NODE_STROKE}
          strokeWidth={1.5}
          fill={anchor.hollow ? "#ffffff" : NODE_STROKE}
          onMouseDown={(e) => {
            if (!anchor.hollow || e.evt.button !== 0) return;
            e.cancelBubble = true;
            onAnchorMouseDown({ x: position.x + anchor.x, y: position.y + anchor.y });
          }}
        />
      ))}
    </Group>
  );
}

/** One connection's edge on the diagram canvas (#209) - drawn border-to-
 * border (not center-to-center), bowed when it's one of several duplicate
 * connections between the same two instances, dashed + labeled when both
 * ends' owning parts have a recorded (and differing) `connector_size_mm` -
 * advisory only, per this product line legitimately stepping down hose
 * sizes via reducer/dripper fittings, never blocking. */
function ConnectionEdge({
  fromPos,
  toPos,
  duplicateIndex,
  mismatchLabel,
  isSelected,
  onSelect,
}: {
  fromPos: Position;
  toPos: Position;
  duplicateIndex: number;
  mismatchLabel: string | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const start = rectBorderIntersection(fromPos.x, fromPos.y, NODE_WIDTH / 2, NODE_HEIGHT / 2, dx, dy);
  const end = rectBorderIntersection(toPos.x, toPos.y, NODE_WIDTH / 2, NODE_HEIGHT / 2, -dx, -dy);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  let points = [start.x, start.y, end.x, end.y];
  let labelX = midX;
  let labelY = midY;
  if (duplicateIndex > 0) {
    const length = Math.hypot(dx, dy) || 1;
    const perpX = -dy / length;
    const perpY = dx / length;
    const sign = duplicateIndex % 2 === 1 ? 1 : -1;
    const magnitude = 16 * Math.ceil(duplicateIndex / 2);
    const bowX = midX + perpX * sign * magnitude;
    const bowY = midY + perpY * sign * magnitude;
    points = [start.x, start.y, bowX, bowY, end.x, end.y];
    labelX = bowX;
    labelY = bowY;
  }

  return (
    <>
      <Line
        points={points}
        tension={duplicateIndex > 0 ? 0.5 : 0}
        stroke={NODE_STROKE}
        strokeWidth={isSelected ? 2.5 : 1.5}
        opacity={isSelected ? 1 : 0.6}
        dash={mismatchLabel ? [4, 3] : undefined}
        hitStrokeWidth={10}
        onClick={(e) => {
          if (e.evt.button !== 0) return;
          onSelect();
        }}
      />
      {mismatchLabel && (
        <Text x={labelX - 30} y={labelY - 6} width={60} align="center" text={mismatchLabel} fontSize={9} fill={MISMATCH_LABEL_COLOR} listening={false} />
      )}
    </>
  );
}

/** The "Pipe network" dialog (#209, rewritten for #254's multi-instance
 * model by #268) - draws/manages the physical irrigation part graph: a
 * left-panel parts catalog (`IrrigationPart` stock rows) and a right-panel
 * `react-konva` node-graph diagram where each node is one independently-
 * placed `IrrigationPartInstance` of a part, connected via
 * `IrrigationConnection` edges keyed on instance id. Self-contained, same
 * pattern as `AddBedForm`/`PlantPicker` - owns its own open state, queries,
 * and mutations; renders both its own toolbar trigger button and the
 * dialog itself so `Layout.tsx` only needs to drop `<PipeNetworkDialog />`
 * into `Toolbar`'s `pipeNetworkTrigger` slot.
 *
 * One documented simplification vs. #209's own design spec: node-drag-live-
 * edge-following uses a plain React state override (re-rendering the whole
 * diagram each drag tick) rather than the imperative Konva-ref/`batchDraw`
 * technique `PolygonEditor.tsx`'s vertex drag uses for the same "many
 * elements to keep in sync on every pointer-move tick" problem - the
 * backend model's own docstring reasoning ("matches this garden's actual
 * scale - a handful of parts") means the perf case that technique exists
 * for doesn't really apply here, and the simpler approach is materially
 * less code for a diagram this small. */
export function PipeNetworkDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<{ fromInstanceId: number; x: number; y: number } | null>(null);
  const [dragOverride, setDragOverride] = useState<{ id: number; x: number; y: number } | null>(null);
  const [confirmDeletePart, setConfirmDeletePart] = useState<IrrigationPart | null>(null);
  const [confirmDeleteInstance, setConfirmDeleteInstance] = useState<IrrigationPartInstance | null>(null);
  const [addForm, setAddForm] = useState<AddPartFormState>({ name: "", partType: "", quantityOnHand: "0" });
  const [addError, setAddError] = useState<string | null>(null);
  const [pointerPos, setPointerPos] = useState<Position | null>(null);

  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const stageRef = useRef<Konva.Stage>(null);
  const { ref: canvasContainerRef, size: canvasSize } = useContainerSize({ width: 560, height: 480 });

  const partsQuery = useQuery({ queryKey: ["irrigation-parts"], queryFn: listIrrigationParts, enabled: open });
  const instancesQuery = useQuery({ queryKey: ["irrigation-part-instances"], queryFn: () => listIrrigationPartInstances(), enabled: open });
  const connectionsQuery = useQuery({ queryKey: ["irrigation-connections"], queryFn: () => listIrrigationConnections(), enabled: open });
  const parts = useMemo(() => partsQuery.data ?? [], [partsQuery.data]);
  const instances = useMemo(() => instancesQuery.data ?? [], [instancesQuery.data]);
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const partsById = useMemo(() => new Map(parts.filter((p) => p.id != null).map((p) => [p.id as number, p])), [parts]);
  const instancesById = useMemo(() => new Map(instances.filter((i) => i.id != null).map((i) => [i.id as number, i])), [instances]);

  useEffect(() => {
    if (!open) {
      setSelectedInstanceId(null);
      setSelectedConnectionId(null);
      setConnecting(null);
      setDragOverride(null);
    }
  }, [open]);

  // #209's design spec: any instance with no diagram position but
  // referenced by an existing connection (e.g. backfilled by #254's own
  // migration from a part that had a connection but no recorded diagram
  // position) gets auto-laid-out once, on open, so a real recorded
  // connection is never silently invisible - a one-time position
  // assignment, immediately persisted, not a per-render recompute.
  const autoLaidOutRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoLaidOutRef.current = false;
      return;
    }
    if (autoLaidOutRef.current || !instancesQuery.data || !connectionsQuery.data) return;
    autoLaidOutRef.current = true;
    const connectedIds = new Set<number>();
    for (const c of connectionsQuery.data) {
      connectedIds.add(c.from_instance_id);
      connectedIds.add(c.to_instance_id);
    }
    const alreadyPositioned = instancesQuery.data.filter((i) => i.diagram_x != null && i.diagram_y != null).length;
    const needsLayout = instancesQuery.data.filter((i) => i.id != null && connectedIds.has(i.id) && (i.diagram_x == null || i.diagram_y == null));
    needsLayout.forEach((instance, i) => {
      if (instance.id == null) return;
      const pos = nextCascadePosition(alreadyPositioned + i);
      updateIrrigationPartInstance(instance.id, { diagram_x: pos.x, diagram_y: pos.y })
        .then((updated) => {
          queryClient.setQueryData<IrrigationPartInstance[]>(["irrigation-part-instances"], (old) => old?.map((i) => (i.id === updated.id ? updated : i)));
        })
        .catch(() => {});
    });
  }, [open, instancesQuery.data, connectionsQuery.data, queryClient]);

  const connectionCountByInstance = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of connections) {
      map.set(c.from_instance_id, (map.get(c.from_instance_id) ?? 0) + 1);
      map.set(c.to_instance_id, (map.get(c.to_instance_id) ?? 0) + 1);
    }
    return map;
  }, [connections]);

  // #254's "needs purchase" is part-level (placed instances vs stock on
  // hand), not per-instance - every node/row for an over-placed part shows
  // the same flag.
  const instanceCountByPart = useMemo(() => {
    const map = new Map<number, number>();
    for (const i of instances) {
      if (i.part_id == null) continue;
      map.set(i.part_id, (map.get(i.part_id) ?? 0) + 1);
    }
    return map;
  }, [instances]);

  const positionedInstances = useMemo(() => instances.filter((i) => i.diagram_x != null && i.diagram_y != null), [instances]);

  function effectivePosition(instance: IrrigationPartInstance): Position {
    if (instance.id != null && dragOverride?.id === instance.id) return { x: dragOverride.x, y: dragOverride.y };
    return { x: instance.diagram_x ?? 0, y: instance.diagram_y ?? 0 };
  }

  // Duplicate-edge bowing (#209): group connections by their unordered
  // instance-id pair, index within each group drives the bow direction/size.
  const connectionDuplicateIndex = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const c of connections) {
      if (c.id == null) continue;
      const key = pairKey(c.from_instance_id, c.to_instance_id);
      const list = groups.get(key) ?? [];
      list.push(c.id);
      groups.set(key, list);
    }
    const indexById = new Map<number, number>();
    for (const ids of groups.values()) {
      ids.forEach((id, i) => indexById.set(id, i));
    }
    return indexById;
  }, [connections]);

  const createPartMutation = useMutation({
    mutationFn: () =>
      createIrrigationPart({
        name: addForm.name.trim(),
        part_type: addForm.partType.trim(),
        quantity_on_hand: addForm.quantityOnHand.trim() === "" ? 0 : Number(addForm.quantityOnHand),
        notes: "",
        connector_size_mm: null,
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<IrrigationPart[]>(["irrigation-parts"], (old) => (old ? [...old, created] : [created]));
      setAddForm({ name: "", partType: "", quantityOnHand: "0" });
    },
    onError: (err: unknown) => setAddError(err instanceof Error ? err.message : "Failed to add part"),
  });

  const updatePartMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof updateIrrigationPart>[1] }) => updateIrrigationPart(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<IrrigationPart[]>(["irrigation-parts"], (old) => (old ? old.map((p) => (p.id === updated.id ? updated : p)) : old));
    },
  });

  const deletePartMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationPart(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<IrrigationPart[]>(["irrigation-parts"], (old) => old?.filter((p) => p.id !== id));
      // The backend cascades every instance of this part (and their own
      // connections) on delete - refetch rather than hand-pruning those
      // caches (simpler, and this dialog already always-refetches fresh on
      // open anyway).
      queryClient.invalidateQueries({ queryKey: ["irrigation-part-instances"] });
      queryClient.invalidateQueries({ queryKey: ["irrigation-connections"] });
      if (selectedInstanceId != null && instancesById.get(selectedInstanceId)?.part_id === id) setSelectedInstanceId(null);
    },
  });

  const createInstanceMutation = useMutation({
    mutationFn: (partId: number) => {
      const pos = nextCascadePosition(positionedInstances.length);
      return createIrrigationPartInstance({ part_id: partId, diagram_x: pos.x, diagram_y: pos.y });
    },
    onSuccess: (created) => {
      queryClient.setQueryData<IrrigationPartInstance[]>(["irrigation-part-instances"], (old) => (old ? [...old, created] : [created]));
    },
  });

  const updateInstanceMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof updateIrrigationPartInstance>[1] }) => updateIrrigationPartInstance(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<IrrigationPartInstance[]>(["irrigation-part-instances"], (old) => (old ? old.map((i) => (i.id === updated.id ? updated : i)) : old));
    },
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationPartInstance(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<IrrigationPartInstance[]>(["irrigation-part-instances"], (old) => old?.filter((i) => i.id !== id));
      // The backend only removes this one instance's own connections, not
      // any sibling instance's - refetch rather than hand-pruning.
      queryClient.invalidateQueries({ queryKey: ["irrigation-connections"] });
      if (selectedInstanceId === id) setSelectedInstanceId(null);
    },
  });

  const createConnectionMutation = useMutation({
    mutationFn: (payload: { from_instance_id: number; to_instance_id: number }) => createIrrigationConnection({ ...payload, notes: "" }),
    onSuccess: (created) => {
      queryClient.setQueryData<IrrigationConnection[]>(["irrigation-connections"], (old) => (old ? [...old, created] : [created]));
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationConnection(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<IrrigationConnection[]>(["irrigation-connections"], (old) => old?.filter((c) => c.id !== id));
      if (selectedConnectionId === id) setSelectedConnectionId(null);
    },
  });

  function submitAddPart(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!addForm.name.trim() || !addForm.partType.trim()) {
      setAddError("Name and part type are required.");
      return;
    }
    createPartMutation.mutate();
  }

  /** Deleting an instance only removes that instance and its own
   * connections (never a sibling instance's) - #254/#268's own copy
   * distinction from deleting a whole catalog part. */
  function requestDeleteInstance(id: number) {
    const instance = instancesById.get(id);
    if (!instance) return;
    const count = connectionCountByInstance.get(id) ?? 0;
    if (count > 0) setConfirmDeleteInstance(instance);
    else deleteInstanceMutation.mutate(id);
  }

  function selectInstance(id: number) {
    setSelectedInstanceId(id);
    setSelectedConnectionId(null);
    const instance = instancesById.get(id);
    if (instance?.part_id != null) rowRefs.current.get(instance.part_id)?.scrollIntoView({ block: "nearest" });
  }

  function handleStageMouseMove() {
    if (!connecting) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (pos) setPointerPos(pos);
  }

  function handleStageMouseUp() {
    if (!connecting) {
      setPointerPos(null);
      return;
    }
    const drop = stageRef.current?.getPointerPosition() ?? pointerPos ?? connecting;
    const target = positionedInstances.find((i) => {
      if (i.id == null || i.id === connecting.fromInstanceId) return false;
      const pos = effectivePosition(i);
      return Math.abs(drop.x - pos.x) <= NODE_WIDTH / 2 && Math.abs(drop.y - pos.y) <= NODE_HEIGHT / 2;
    });
    if (target?.id != null) {
      createConnectionMutation.mutate({ from_instance_id: connecting.fromInstanceId, to_instance_id: target.id });
    }
    setConnecting(null);
    setPointerPos(null);
  }

  useEffect(() => {
    if (!open || (selectedConnectionId == null && selectedInstanceId == null)) return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      if (selectedConnectionId != null) deleteConnectionMutation.mutate(selectedConnectionId);
      else if (selectedInstanceId != null) requestDeleteInstance(selectedInstanceId);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedConnectionId, selectedInstanceId, deleteConnectionMutation]);

  const selectedConnection = connections.find((c) => c.id === selectedConnectionId) ?? null;
  const selectedInstance = selectedInstanceId != null ? (instancesById.get(selectedInstanceId) ?? null) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Waypoints /> Pipe network
          </Button>
        }
      />
      <DialogPopup>
        <Card className="flex h-[600px] w-[960px] max-w-[95vw] flex-col p-0">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <DialogTitle className="text-sm font-medium">Pipe network</DialogTitle>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3">
              <form className="flex flex-col gap-1.5 border-b pb-3" onSubmit={submitAddPart}>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Name</span>
                  <Input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Part type</span>
                  <Input
                    list="pipe-network-part-types"
                    value={addForm.partType}
                    onChange={(e) => setAddForm((f) => ({ ...f, partType: e.target.value }))}
                  />
                  <datalist id="pipe-network-part-types">
                    {PART_TYPE_SUGGESTIONS.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Quantity on hand</span>
                  <Input
                    type="number"
                    value={addForm.quantityOnHand}
                    onChange={(e) => setAddForm((f) => ({ ...f, quantityOnHand: e.target.value }))}
                  />
                </label>
                {addError && <p className="text-xs text-destructive">{addError}</p>}
                <Button type="submit" size="sm" disabled={createPartMutation.isPending}>
                  <Plus /> Add part
                </Button>
              </form>

              <div className="flex flex-col gap-1">
                {parts.length === 0 && <p className="text-xs text-muted-foreground">No irrigation parts yet - add one below.</p>}
                {parts.map((part) => (
                  <PartRow
                    key={part.id}
                    part={part}
                    instanceCount={part.id != null ? (instanceCountByPart.get(part.id) ?? 0) : 0}
                    isSelected={selectedInstance != null && selectedInstance.part_id === part.id}
                    onAddInstance={() => part.id != null && createInstanceMutation.mutate(part.id)}
                    onUpdateField={(patch) => part.id != null && updatePartMutation.mutate({ id: part.id, patch })}
                    onDelete={() => {
                      const count = part.id != null ? (instanceCountByPart.get(part.id) ?? 0) : 0;
                      if (count > 0) setConfirmDeletePart(part);
                      else if (part.id != null) deletePartMutation.mutate(part.id);
                    }}
                    rowRef={(node) => {
                      if (part.id == null) return;
                      if (node) rowRefs.current.set(part.id, node);
                      else rowRefs.current.delete(part.id);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="relative flex-1 bg-muted/30">
              <div ref={canvasContainerRef} className="absolute inset-0">
                {positionedInstances.length === 0 && (
                  <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
                    Add a part, then add an instance of it to the diagram to start connecting it to others.
                  </p>
                )}
                <Stage
                  ref={stageRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                  onClick={(e) => {
                    if (e.target === e.target.getStage()) {
                      setSelectedInstanceId(null);
                      setSelectedConnectionId(null);
                    }
                  }}
                >
                  <Layer>
                    {connections.map((connection) => {
                      if (connection.id == null) return null;
                      const fromInstance = instancesById.get(connection.from_instance_id);
                      const toInstance = instancesById.get(connection.to_instance_id);
                      if (!fromInstance || !toInstance) return null;
                      if (fromInstance.diagram_x == null || toInstance.diagram_x == null) return null;
                      const fromPart = fromInstance.part_id != null ? partsById.get(fromInstance.part_id) : undefined;
                      const toPart = toInstance.part_id != null ? partsById.get(toInstance.part_id) : undefined;
                      const bothSized = fromPart?.connector_size_mm != null && toPart?.connector_size_mm != null;
                      const mismatch = bothSized && fromPart?.connector_size_mm !== toPart?.connector_size_mm;
                      return (
                        <ConnectionEdge
                          key={connection.id}
                          fromPos={effectivePosition(fromInstance)}
                          toPos={effectivePosition(toInstance)}
                          duplicateIndex={connectionDuplicateIndex.get(connection.id) ?? 0}
                          mismatchLabel={mismatch ? `${fromPart?.connector_size_mm} -> ${toPart?.connector_size_mm}mm` : null}
                          isSelected={selectedConnectionId === connection.id}
                          onSelect={() => {
                            setSelectedConnectionId(connection.id ?? null);
                            setSelectedInstanceId(null);
                          }}
                        />
                      );
                    })}
                    {connecting && pointerPos && (
                      <Line points={[connecting.x, connecting.y, pointerPos.x, pointerPos.y]} stroke={NODE_STROKE} strokeWidth={1.5} dash={[4, 3]} listening={false} />
                    )}
                    {positionedInstances.map((instance) => {
                      if (instance.id == null || instance.part_id == null) return null;
                      const part = partsById.get(instance.part_id);
                      if (!part) return null;
                      const connectionCount = connectionCountByInstance.get(instance.id) ?? 0;
                      const needsPurchase = (instanceCountByPart.get(instance.part_id) ?? 0) > part.quantity_on_hand;
                      return (
                        <PartNode
                          key={instance.id}
                          part={part}
                          position={effectivePosition(instance)}
                          connectionCount={connectionCount}
                          needsPurchase={needsPurchase}
                          isSelected={selectedInstanceId === instance.id}
                          onSelect={() => selectInstance(instance.id as number)}
                          onDragMove={(pos) => setDragOverride({ id: instance.id as number, x: pos.x, y: pos.y })}
                          onDragEnd={(pos) => {
                            setDragOverride(null);
                            updateInstanceMutation.mutate({ id: instance.id as number, patch: { diagram_x: pos.x, diagram_y: pos.y } });
                          }}
                          onAnchorMouseDown={(anchorPos) => setConnecting({ fromInstanceId: instance.id as number, x: anchorPos.x, y: anchorPos.y })}
                        />
                      );
                    })}
                  </Layer>
                </Stage>
              </div>
              {selectedConnection && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t bg-card/95 px-3 py-1.5 text-xs backdrop-blur-sm">
                  <span>
                    {partsById.get(instancesById.get(selectedConnection.from_instance_id)?.part_id ?? -1)?.name ?? "?"} ↔{" "}
                    {partsById.get(instancesById.get(selectedConnection.to_instance_id)?.part_id ?? -1)?.name ?? "?"}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => selectedConnection.id != null && deleteConnectionMutation.mutate(selectedConnection.id)}
                  >
                    Remove connection
                  </Button>
                </div>
              )}
              {!selectedConnection && selectedInstance && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t bg-card/95 px-3 py-1.5 text-xs backdrop-blur-sm">
                  <span>{partsById.get(selectedInstance.part_id)?.name ?? "?"}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => selectedInstance.id != null && requestDeleteInstance(selectedInstance.id)}
                  >
                    Remove from diagram
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </DialogPopup>

      <AlertDialog open={confirmDeletePart != null} onOpenChange={(next) => !next && setConfirmDeletePart(null)}>
        <AlertDialogPopup>
          <AlertDialogTitle>Delete "{confirmDeletePart?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This part has {confirmDeletePart?.id != null ? (instanceCountByPart.get(confirmDeletePart.id) ?? 0) : 0} instance(s) placed on the
            diagram - deleting it removes those instances and their connections too.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeletePart?.id != null) deletePartMutation.mutate(confirmDeletePart.id);
                setConfirmDeletePart(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog open={confirmDeleteInstance != null} onOpenChange={(next) => !next && setConfirmDeleteInstance(null)}>
        <AlertDialogPopup>
          <AlertDialogTitle>Remove this instance from the diagram?</AlertDialogTitle>
          <AlertDialogDescription>
            This instance has {confirmDeleteInstance?.id != null ? (connectionCountByInstance.get(confirmDeleteInstance.id) ?? 0) : 0}{" "}
            connection(s) - removing it removes those too. Other instances of the same part keep their own connections.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeleteInstance?.id != null) deleteInstanceMutation.mutate(confirmDeleteInstance.id);
                setConfirmDeleteInstance(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Dialog>
  );
}
