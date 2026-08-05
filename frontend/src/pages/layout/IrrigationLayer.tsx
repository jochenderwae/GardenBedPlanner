import { forwardRef, useImperativeHandle, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Layer, Line, Rect, Text } from "react-konva";
import type { Bed, Garden, Geometry, IrrigationConnection, IrrigationPart, IrrigationPartInstance, IrrigationPartType } from "@/api/client";
import { boundingRect, snapToGrid } from "./geometry";
import { PartTypeIcon } from "./irrigationPartIcons";
import {
  anchorCountFor,
  anchorNormal,
  anchorPosition,
  anchorSlotFor,
  computeAnchorSlots,
  computeDuplicateIndex,
  connectionGeometry,
  cubicBezierPoint,
  type ConnectionCurveTuning,
  type ConnectionGeometry,
  type Position,
} from "./irrigationConnectionGeometry";
import type { Viewport } from "./viewport";

// #250: the real-garden-space successor to the now-retired
// `PipeNetworkDialog.tsx`'s schematic node-graph canvas - see
// product-owner/research/irrigation-editor-merge.md for the full design
// rationale this file implements. Two things are deliberately different from
// every other real-canvas layer in this editor (BedNode/PlantPlacementLayer/
// EquipmentLayer):
//
// - Nodes render at a **fixed on-screen icon size** (section 3) rather than
//   a to-scale footprint - a real irrigation fitting (a few mm-cm) would be
//   an invisible/unclickable dot at this canvas's normal cm->px scale, so
//   `ICON_SIZE_PX`/`ANCHOR_*_PX` below are divided by `viewport.scale` each
//   render (the same `strokeWidth={1 / viewport.scale}` trick `RulerLayer`
//   already uses) so the icon and its anchors/connection-drag tolerances
//   stay a constant screen size regardless of zoom, instead of shrinking to
//   nothing zoomed out or ballooning zoomed in.
// - Instances render directly in world/garden-space coordinates (no nested
//   per-bed `<Group>`, unlike `PlantPlacementLayer`) - `EquipmentLayer.tsx`'s
//   own `bedRect.x + itemRect.x` convention, not that one's per-bed
//   coordinate frame - because a connection routinely spans two instances in
//   *different* containers (one bed to another, or a bed to open garden
//   space), so every position this file works with needs to already be in
//   one shared coordinate space rather than requiring a per-connection
//   container-to-container conversion.

const ICON_SIZE_PX = 22;
const ANCHOR_RADIUS_PX = 3.5;
// #253: how close a connection-drag drop needs to land to a drawn anchor
// circle to count as hitting it.
const ANCHOR_DROP_RADIUS_PX = 12;
const BEZIER_CONTROL_FRACTION = 0.4;
const BEZIER_CONTROL_MIN_PX = 20;
const BEZIER_CONTROL_MAX_PX = 90;
const DUPLICATE_OFFSET_STEP_PX = 8;
const REJECT_FLASH_MS = 400;
const REJECT_FLASH_COLOR = "#dc2626";
const NODE_STROKE = "#0891b2";
const NODE_NEEDS_PURCHASE_STROKE = "#dc2626";
const MISMATCH_LABEL_COLOR = "#d97706";
// #271's own docstring: "individual placements use a small rectangle
// centered on the point" - a real physical fitting's own footprint is
// genuinely centimeter-scale, so this is a plausible-enough placeholder
// size, not an attempt at a to-scale placement (see this file's own header
// comment on why the *rendered* icon is fixed-screen-size instead).
const PLACEMENT_FOOTPRINT_CM = 6;

// #252: anchors are colored by the owning part's `connector_size_mm` so two
// compatible-size anchors read as visually related at a glance - kept local
// to this file (not the shared geometry module) since it's purely
// part-data-driven, not coordinate-space-driven (see
// irrigationConnectionGeometry.ts's own doc).
const CONNECTOR_SIZE_COLORS: Record<number, string> = {
  4: "#f97316",
  6: "#eab308",
  9: "#22c55e",
  13: "#0ea5e9",
  16: "#6366f1",
  20: "#a855f7",
  25: "#ec4899",
};
const CONNECTOR_SIZE_FALLBACK_COLOR = "#64748b";
const CONNECTOR_SIZE_UNSET_COLOR = "#cbd5e1";

function connectorSizeColor(mm: number | null | undefined): string {
  if (mm == null) return CONNECTOR_SIZE_UNSET_COLOR;
  return CONNECTOR_SIZE_COLORS[mm] ?? CONNECTOR_SIZE_FALLBACK_COLOR;
}

function centerOfGeometry(geometry: Geometry): Position {
  const rect = boundingRect(geometry);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function footprintGeometryAt(center: Position): Geometry {
  return {
    type: "rectangle",
    x: snapToGrid(center.x) - PLACEMENT_FOOTPRINT_CM / 2,
    y: snapToGrid(center.y) - PLACEMENT_FOOTPRINT_CM / 2,
    width: PLACEMENT_FOOTPRINT_CM,
    height: PLACEMENT_FOOTPRINT_CM,
    rotation: 0,
  };
}

/** What's currently "armed" from the toolbar/side-panel parts catalog
 * (section 5) - either a catalog `IrrigationPart` to create-and-place a
 * brand new instance of, or a specific already-existing but unplaced
 * `IrrigationPartInstance` to give a real position for the first time
 * (#250's own migration path: an instance created before this merge, still
 * only carrying the old schematic `diagram_x`/`diagram_y`, keeps its
 * existing connections intact - re-placing it via this same click-to-place
 * gesture just fills in `bed_id`/`garden_id`/`geometry` on that same row,
 * rather than losing its connection history by deleting and recreating
 * it). */
export type ArmedIrrigationTarget =
  | { mode: "create"; part: IrrigationPart }
  | { mode: "position"; instance: IrrigationPartInstance; part: IrrigationPart | undefined };

export function armedIrrigationTargetLabel(target: ArmedIrrigationTarget): string {
  return target.mode === "create" ? target.part.name : (target.part?.name ?? "part");
}

interface IrrigationLayerProps {
  beds: Bed[];
  garden: Garden | null;
  parts: IrrigationPart[];
  partTypes: IrrigationPartType[];
  instances: IrrigationPartInstance[];
  connections: IrrigationConnection[];
  active: boolean;
  armedTarget: ArmedIrrigationTarget | null;
  viewport: Viewport;
  selectedInstanceId: number | null;
  selectedConnectionId: number | null;
  onSelectInstance: (id: number | null) => void;
  onSelectConnection: (id: number | null) => void;
  /** Fired on a successful click-to-place gesture - `target` is whatever was
   * armed at click time, `patch` is the resulting bed-local or garden-local
   * placement to persist (create a new instance for `"create"`, update the
   * existing one for `"position"` - see `ArmedIrrigationTarget`'s own doc). */
  onPlace: (target: ArmedIrrigationTarget, patch: { bed_id: number | null; garden_id: number | null; geometry: Geometry }) => void;
  onMoveInstance: (instance: IrrigationPartInstance, geometry: Geometry) => void;
  onConnect: (fromInstanceId: number, toInstanceId: number) => void;
}

export interface IrrigationLayerHandle {
  /** Layout.tsx forwards its own Stage mousedown here only for the "landed
   * on bare canvas, not on any bed's own hit-rect" case (#250's garden_id
   * placement target, section 5) - mirrors
   * `PlantPlacementLayerHandle.handleStageMouseDown`'s identical role for
   * garden-wide marquee-select (#19's third round), reused rather than
   * reinvented. */
  handleStageMouseDown: (worldPos: Position) => void;
  /** Drives an in-progress connection-drag's live preview line - a plain
   * per-shape mousemove listener stops firing the instant the pointer
   * leaves the small anchor circle it started on, so this needs the same
   * Stage-level forwarding `PlantPlacementLayerHandle` established for its
   * own draw/marquee gestures. */
  handleStageMouseMove: (worldPos: Position) => void;
  /** Completes an in-progress connection-drag (#253's anchor-precise drop,
   * now against real, viewport-scaled anchor positions instead of the old
   * dialog's fixed schematic px). */
  handleStageMouseUp: (worldPos: Position) => void;
}

/** One placed instance's node (#250, the real-canvas successor to
 * `PipeNetworkDialog.tsx`'s `PartNode`) - a small fixed-screen-size rounded
 * square (section 3) with the owning part's vector icon (`PartTypeIcon`,
 * #252), evenly-spaced anchor circles around its border (hollow = free,
 * filled = already connected, colored by `connector_size_mm`), and a
 * name/type label that only renders while selected or hovered (section 3's
 * "on-demand label display" recommendation - a dense real canvas with
 * several placed instances can't afford every node showing a permanent
 * label the way the old dialog's much larger, much sparser schematic nodes
 * could). */
function IrrigationNode({
  part,
  position,
  iconSize,
  anchorRadius,
  anchorCount,
  connectionCount,
  needsPurchase,
  isSelected,
  showLabel,
  draggable,
  onSelect,
  onHoverChange,
  onDragMove,
  onDragEnd,
  onAnchorMouseDown,
}: {
  part: IrrigationPart;
  position: Position;
  iconSize: number;
  anchorRadius: number;
  anchorCount: number;
  connectionCount: number;
  needsPurchase: boolean;
  isSelected: boolean;
  showLabel: boolean;
  draggable: boolean;
  onSelect: () => void;
  onHoverChange: (hovering: boolean) => void;
  onDragMove: (pos: Position) => void;
  onDragEnd: (pos: Position) => void;
  onAnchorMouseDown: (anchorAbsolutePos: Position) => void;
}) {
  const stroke = needsPurchase ? NODE_NEEDS_PURCHASE_STROKE : NODE_STROKE;
  const filledCount = Math.min(connectionCount, anchorCount);
  const anchorColor = connectorSizeColor(part.connector_size_mm);
  const anchors = Array.from({ length: anchorCount }, (_, i) => ({
    ...anchorPosition(iconSize, iconSize, { x: 0, y: 0 }, i, anchorCount),
    hollow: i >= filledCount,
  }));

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable={draggable}
      onClick={(e) => {
        if (e.evt.button !== 0) return;
        onSelect();
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onDragMove={(e) => onDragMove({ x: e.target.x(), y: e.target.y() })}
      onDragEnd={(e) => onDragEnd({ x: e.target.x(), y: e.target.y() })}
    >
      <Rect
        x={-iconSize / 2}
        y={-iconSize / 2}
        width={iconSize}
        height={iconSize}
        cornerRadius={iconSize * 0.2}
        fill="#ffffff"
        stroke={stroke}
        strokeWidth={isSelected ? 2 : 1.2}
      />
      <Group scaleX={iconSize / 22} scaleY={iconSize / 22} listening={false}>
        <PartTypeIcon partType={part.part_type} />
      </Group>
      {needsPurchase && (
        <Circle x={iconSize / 2 - 2} y={-iconSize / 2 + 2} radius={3} fill={NODE_NEEDS_PURCHASE_STROKE} listening={false} />
      )}
      {anchors.map((anchor, i) => (
        <Circle
          key={i}
          x={anchor.x}
          y={anchor.y}
          radius={anchorRadius}
          stroke={anchorColor}
          strokeWidth={1.2}
          fill={anchor.hollow ? "#ffffff" : anchorColor}
          onMouseDown={(e) => {
            if (!anchor.hollow || e.evt.button !== 0) return;
            e.cancelBubble = true;
            onAnchorMouseDown({ x: position.x + anchor.x, y: position.y + anchor.y });
          }}
        />
      ))}
      {showLabel && (
        <>
          <Rect x={-iconSize / 2 - 2} y={iconSize / 2 + 2} width={Math.max(70, part.name.length * 5.5)} height={14} fill="#ffffffee" cornerRadius={2} listening={false} />
          <Text x={-iconSize / 2} y={iconSize / 2 + 4} text={`${part.name} (${part.part_type})`} fontSize={9} fill="#0f172a" listening={false} />
        </>
      )}
    </Group>
  );
}

/** One connection's curved edge (#250, the real-canvas successor to
 * `PipeNetworkDialog.tsx`'s `ConnectionEdge`) - same anchor-precise/
 * direction-aware bezier as the old dialog (#253/#256, via the shared
 * `irrigationConnectionGeometry.ts` module), just fed real cm positions
 * instead of schematic px ones. */
function ConnectionEdge({
  geometry,
  mismatchLabel,
  isSelected,
  strokeWidth,
  onSelect,
}: {
  geometry: ConnectionGeometry;
  mismatchLabel: string | null;
  isSelected: boolean;
  strokeWidth: number;
  onSelect: () => void;
}) {
  const { start, cp1, cp2, end } = geometry;
  const points = [start.x, start.y, cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y];
  const label = cubicBezierPoint(start, cp1, cp2, end, 0.5);

  return (
    <>
      <Line
        points={points}
        bezier
        stroke={NODE_STROKE}
        strokeWidth={isSelected ? strokeWidth * 1.8 : strokeWidth}
        opacity={isSelected ? 1 : 0.6}
        dash={mismatchLabel ? [4, 3] : undefined}
        hitStrokeWidth={Math.max(10, strokeWidth * 6)}
        onClick={(e) => {
          if (e.evt.button !== 0) return;
          onSelect();
        }}
      />
      {mismatchLabel && (
        <Text x={label.x - 30} y={label.y - 6} width={60} align="center" text={mismatchLabel} fontSize={9} fill={MISMATCH_LABEL_COLOR} listening={false} />
      )}
    </>
  );
}

/** The main real-canvas irrigation layer (#250) - gated `tab === "equipment"`
 * by `Layout.tsx`, same "one dedicated Layer per object type" convention
 * `DecorationLayer`/`EquipmentLayer`/`PlantPlacementLayer` already use.
 * Placement (arm a part from the side panel, click the canvas) and
 * connection-dragging (mousedown on a hollow anchor, drag, drop on another
 * instance's hollow anchor) both live here, following
 * `PlantPlacementLayer.tsx`'s arm-then-click interaction model rather than
 * `EquipmentLayer.tsx`'s read-only/form-only one (see this ticket's own
 * research doc, section 5, for why the latter isn't actually the right
 * precedent despite looking more visually similar). */
export const IrrigationLayer = forwardRef<IrrigationLayerHandle, IrrigationLayerProps>(function IrrigationLayer(
  {
    beds,
    garden,
    parts,
    partTypes,
    instances,
    connections,
    active,
    armedTarget,
    viewport,
    selectedInstanceId,
    selectedConnectionId,
    onSelectInstance,
    onSelectConnection,
    onPlace,
    onMoveInstance,
    onConnect,
  },
  ref,
) {
  const [dragOverride, setDragOverride] = useState<{ id: number; x: number; y: number } | null>(null);
  const [connecting, setConnecting] = useState<{ fromInstanceId: number; x: number; y: number } | null>(null);
  const [pointerPos, setPointerPos] = useState<Position | null>(null);
  const [rejectFlash, setRejectFlash] = useState<Position | null>(null);
  const [hoveredInstanceId, setHoveredInstanceId] = useState<number | null>(null);

  // Section 3/4: fixed on-screen sizes/tolerances, converted to world (cm)
  // units for this render's zoom level so they read as a constant screen
  // size regardless of pan/zoom - the same `strokeWidth={1 / viewport.scale}`
  // trick RulerLayer/GridLines already use elsewhere in this editor.
  const iconSize = ICON_SIZE_PX / viewport.scale;
  const anchorRadius = ANCHOR_RADIUS_PX / viewport.scale;
  const anchorDropRadius = ANCHOR_DROP_RADIUS_PX / viewport.scale;
  const edgeStrokeWidth = 1.5 / viewport.scale;
  const tuning: ConnectionCurveTuning = {
    controlFraction: BEZIER_CONTROL_FRACTION,
    controlMin: BEZIER_CONTROL_MIN_PX / viewport.scale,
    controlMax: BEZIER_CONTROL_MAX_PX / viewport.scale,
    duplicateOffsetStep: DUPLICATE_OFFSET_STEP_PX / viewport.scale,
  };

  const bedRectById = new Map(beds.filter((b) => b.id != null).map((b) => [b.id as number, boundingRect(b.border_geometry)]));
  const gardenRect = garden ? boundingRect(garden.border_geometry) : null;
  const partsById = new Map(parts.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const partTypeByPartId = new Map(
    parts.filter((p) => p.id != null).map((p) => [p.id as number, partTypes.find((t) => t.slug === p.part_type || t.name === p.part_type)]),
  );

  const connectionCountByInstance = new Map<number, number>();
  for (const c of connections) {
    connectionCountByInstance.set(c.from_instance_id, (connectionCountByInstance.get(c.from_instance_id) ?? 0) + 1);
    connectionCountByInstance.set(c.to_instance_id, (connectionCountByInstance.get(c.to_instance_id) ?? 0) + 1);
  }
  const instanceCountByPart = new Map<number, number>();
  for (const i of instances) {
    if (i.part_id == null) continue;
    instanceCountByPart.set(i.part_id, (instanceCountByPart.get(i.part_id) ?? 0) + 1);
  }
  const anchorSlots = computeAnchorSlots(connections);
  const duplicateIndexByConnection = computeDuplicateIndex(connections);

  function anchorCountForInstance(instance: IrrigationPartInstance): number {
    if (instance.id == null) return 2;
    const connectionCount = connectionCountByInstance.get(instance.id) ?? 0;
    const portCount = instance.part_id != null ? partTypeByPartId.get(instance.part_id)?.connection_count : undefined;
    return anchorCountFor(connectionCount, portCount);
  }

  /** World position of a placed instance - `bedRect.x + center.x` for a
   * bed-anchored instance, `gardenRect.x + center.x` for a garden-anchored
   * one, matching `EquipmentLayer.tsx`'s identical per-item offset
   * convention. `null` for an instance with no real placement yet (#250's
   * migration case - an instance created before this merge, still only
   * carrying the old schematic `diagram_x`/`diagram_y`) - those render in
   * the side panel's "unplaced" tray instead (`IrrigationPartsPanel.tsx`),
   * not here. */
  function instanceWorldPosition(instance: IrrigationPartInstance): Position | null {
    if (instance.geometry == null) return null;
    const center = centerOfGeometry(instance.geometry);
    if (instance.bed_id != null) {
      const bedRect = bedRectById.get(instance.bed_id);
      if (!bedRect) return null;
      return { x: bedRect.x + center.x, y: bedRect.y + center.y };
    }
    if (instance.garden_id != null && gardenRect) {
      return { x: gardenRect.x + center.x, y: gardenRect.y + center.y };
    }
    return null;
  }

  const placed: { instance: IrrigationPartInstance; pos: Position; anchorCount: number }[] = [];
  for (const instance of instances) {
    if (instance.id == null || instance.part_id == null) continue;
    const pos = instanceWorldPosition(instance);
    if (!pos) continue;
    placed.push({ instance, pos, anchorCount: anchorCountForInstance(instance) });
  }
  const placedById = new Map(placed.map((p) => [p.instance.id as number, p]));

  function effectivePosition(instanceId: number, pos: Position): Position {
    if (dragOverride?.id === instanceId) return { x: dragOverride.x, y: dragOverride.y };
    return pos;
  }

  function instanceHasFreePort(entry: { instance: IrrigationPartInstance; anchorCount: number }): boolean {
    if (entry.instance.id == null || entry.instance.part_id == null) return true;
    const portCount = partTypeByPartId.get(entry.instance.part_id)?.connection_count;
    if (portCount == null) return true;
    return (connectionCountByInstance.get(entry.instance.id) ?? 0) < portCount;
  }

  /** Completes a click-to-place placement, landing either inside a bed
   * (`bedId` set) or on open garden canvas (`gardenId` set, forwarded from
   * `handleStageMouseDown` below) - section 5's "the click target decides
   * which" rule. */
  function completePlacement(bedId: number | null, gardenId: number | null, worldPos: Position) {
    if (!armedTarget) return;
    const containerOffset = bedId != null ? bedRectById.get(bedId) : gardenRect;
    if (!containerOffset) return;
    const localCenter = { x: worldPos.x - containerOffset.x, y: worldPos.y - containerOffset.y };
    onPlace(armedTarget, { bed_id: bedId, garden_id: gardenId, geometry: footprintGeometryAt(localCenter) });
  }

  function handleBedClick(bedId: number, e: Konva.KonvaEventObject<MouseEvent>) {
    if (!active || !armedTarget) return;
    const worldPos = e.target.getStage()?.getRelativePointerPosition();
    if (!worldPos) return;
    completePlacement(bedId, null, worldPos);
  }

  useImperativeHandle(
    ref,
    () => ({
      handleStageMouseDown(worldPos) {
        if (!active || !armedTarget || !garden || garden.id == null) return;
        completePlacement(null, garden.id, worldPos);
      },
      handleStageMouseMove(worldPos) {
        if (connecting) setPointerPos(worldPos);
      },
      handleStageMouseUp(worldPos) {
        if (!connecting) {
          setPointerPos(null);
          return;
        }
        const drop = worldPos;
        let matchedInstanceId: number | null = null;
        for (const entry of placed) {
          if (entry.instance.id == null || entry.instance.id === connecting.fromInstanceId || !instanceHasFreePort(entry)) continue;
          const pos = effectivePosition(entry.instance.id, entry.pos);
          const connectionCount = connectionCountByInstance.get(entry.instance.id) ?? 0;
          for (let i = connectionCount; i < entry.anchorCount; i++) {
            const anchor = anchorPosition(iconSize, iconSize, pos, i, entry.anchorCount);
            if (Math.hypot(drop.x - anchor.x, drop.y - anchor.y) <= anchorDropRadius) {
              matchedInstanceId = entry.instance.id;
              break;
            }
          }
          if (matchedInstanceId != null) break;
        }
        if (matchedInstanceId != null) {
          onConnect(connecting.fromInstanceId, matchedInstanceId);
        } else {
          setRejectFlash(drop);
          window.setTimeout(() => setRejectFlash(null), REJECT_FLASH_MS);
        }
        setConnecting(null);
        setPointerPos(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, armedTarget, garden, connecting, placed, anchorDropRadius, iconSize],
  );

  function connectionGeometryFor(connection: IrrigationConnection): ConnectionGeometry | null {
    if (connection.id == null) return null;
    const from = placedById.get(connection.from_instance_id);
    const to = placedById.get(connection.to_instance_id);
    if (!from || !to) return null;
    const fromPos = effectivePosition(connection.from_instance_id, from.pos);
    const toPos = effectivePosition(connection.to_instance_id, to.pos);
    const fromSlot = anchorSlotFor(anchorSlots, connection.from_instance_id, connection.id, from.anchorCount);
    const toSlot = anchorSlotFor(anchorSlots, connection.to_instance_id, connection.id, to.anchorCount);
    const start = anchorPosition(iconSize, iconSize, fromPos, fromSlot, from.anchorCount);
    const end = anchorPosition(iconSize, iconSize, toPos, toSlot, to.anchorCount);
    const startNormal = anchorNormal(iconSize, iconSize, fromSlot, from.anchorCount);
    const endNormal = anchorNormal(iconSize, iconSize, toSlot, to.anchorCount);
    return connectionGeometry(start, end, startNormal, endNormal, duplicateIndexByConnection.get(connection.id) ?? 0, tuning);
  }

  return (
    <Layer>
      {beds.map((bed) => {
        if (bed.id == null) return null;
        const rect = bedRectById.get(bed.id);
        if (!rect) return null;
        return (
          <Rect
            key={`hit-${bed.id}`}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            listening={active && armedTarget != null}
            onClick={(e) => handleBedClick(bed.id as number, e)}
          />
        );
      })}
      {connections.map((connection) => {
        if (connection.id == null) return null;
        const geometry = connectionGeometryFor(connection);
        if (!geometry) return null;
        const fromInstance = placedById.get(connection.from_instance_id)?.instance;
        const toInstance = placedById.get(connection.to_instance_id)?.instance;
        const fromPart = fromInstance?.part_id != null ? partsById.get(fromInstance.part_id) : undefined;
        const toPart = toInstance?.part_id != null ? partsById.get(toInstance.part_id) : undefined;
        const bothSized = fromPart?.connector_size_mm != null && toPart?.connector_size_mm != null;
        const mismatch = bothSized && fromPart?.connector_size_mm !== toPart?.connector_size_mm;
        return (
          <ConnectionEdge
            key={connection.id}
            geometry={geometry}
            mismatchLabel={mismatch ? `${fromPart?.connector_size_mm} -> ${toPart?.connector_size_mm}mm` : null}
            isSelected={selectedConnectionId === connection.id}
            strokeWidth={edgeStrokeWidth}
            onSelect={() => {
              onSelectConnection(connection.id ?? null);
              onSelectInstance(null);
            }}
          />
        );
      })}
      {connecting && pointerPos && (
        <Line points={[connecting.x, connecting.y, pointerPos.x, pointerPos.y]} stroke={NODE_STROKE} strokeWidth={edgeStrokeWidth} dash={[4, 3]} listening={false} />
      )}
      {rejectFlash && (
        <Circle x={rejectFlash.x} y={rejectFlash.y} radius={anchorDropRadius} stroke={REJECT_FLASH_COLOR} strokeWidth={edgeStrokeWidth * 1.5} listening={false} />
      )}
      {placed.map(({ instance, pos, anchorCount }) => {
        const part = instance.part_id != null ? partsById.get(instance.part_id) : undefined;
        if (!part || instance.id == null) return null;
        const connectionCount = connectionCountByInstance.get(instance.id) ?? 0;
        const needsPurchase = (instanceCountByPart.get(instance.part_id as number) ?? 0) > part.quantity_on_hand;
        const effPos = effectivePosition(instance.id, pos);
        return (
          <IrrigationNode
            key={instance.id}
            part={part}
            position={effPos}
            iconSize={iconSize}
            anchorRadius={anchorRadius}
            anchorCount={anchorCount}
            connectionCount={connectionCount}
            needsPurchase={needsPurchase}
            isSelected={selectedInstanceId === instance.id}
            showLabel={selectedInstanceId === instance.id || hoveredInstanceId === instance.id}
            draggable={active}
            onSelect={() => {
              onSelectInstance(instance.id as number);
              onSelectConnection(null);
            }}
            onHoverChange={(hovering) => setHoveredInstanceId(hovering ? (instance.id as number) : null)}
            onDragMove={(dragPos) => setDragOverride({ id: instance.id as number, x: dragPos.x, y: dragPos.y })}
            onDragEnd={(dragPos) => {
              setDragOverride(null);
              const containerOffset = instance.bed_id != null ? bedRectById.get(instance.bed_id) : gardenRect;
              if (!containerOffset) return;
              const localCenter = { x: dragPos.x - containerOffset.x, y: dragPos.y - containerOffset.y };
              onMoveInstance(instance, footprintGeometryAt(localCenter));
            }}
            onAnchorMouseDown={(anchorAbsolutePos) => setConnecting({ fromInstanceId: instance.id as number, x: anchorAbsolutePos.x, y: anchorAbsolutePos.y })}
          />
        );
      })}
    </Layer>
  );
});
