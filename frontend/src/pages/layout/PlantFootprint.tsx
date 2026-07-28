import type Konva from "konva";
import { Circle, Group, Rect, RegularPolygon, Ring, Star } from "react-konva";

/** The ETL's authored vocabulary (`data/plant.schema.json`'s own
 * `growth_habit` enum) - not enforced as a real enum at the API layer
 * (`Plant.growth_habit` is plain `string | null`), so this is only used as
 * a lookup key set, never assumed to be the full range of values that
 * could show up. */
const KNOWN_HABITS = ["upright", "spreading", "climbing", "rosette", "tree"] as const;
type KnownGrowthHabit = (typeof KNOWN_HABITS)[number];
const KNOWN_HABIT_SET = new Set<string>(KNOWN_HABITS);

function normalizeHabit(growthHabit: string | null | undefined): KnownGrowthHabit | null {
  if (!growthHabit) return null;
  const key = growthHabit.trim().toLowerCase();
  return KNOWN_HABIT_SET.has(key) ? (key as KnownGrowthHabit) : null;
}

interface PlantFootprintProps {
  /** Free text, not a closed enum - anything not in `KNOWN_HABITS` (including
   * `null`/`undefined`, i.e. no value set at all) falls back to the plain
   * circle every plant used to render as, rather than erroring. */
  growthHabit: string | null | undefined;
  x: number;
  y: number;
  radius: number;
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  /** Konva's own `dash` line-pattern (e.g. `[4, 4]`) - used to mark a
   * planting scheduled for a future removal (#180's Edit-tab visual
   * treatment) without a separate badge/icon. `undefined` (the default)
   * renders a solid stroke, same as before this prop existed. */
  dash?: number[];
  draggable?: boolean;
  listening?: boolean;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onTap?: () => void;
  onMouseEnter?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseMove?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave?: () => void;
  /** Escape hatch to grab the underlying Konva node regardless of which
   * shape variant this renders as - callers use it to imperatively
   * reposition *other* markers during a multi-select group drag (see
   * PlantPlacementLayer.tsx's `registerNode`/live group-follow, #19). A
   * plain callback rather than `forwardRef` since each growth-habit variant
   * below is a different concrete Konva shape type (Circle/Star/Group/...)
   * - a callback typed against the common `Konva.Node` base sidesteps the
   * ref-object variance issues a single `forwardRef<T>` would hit trying to
   * union all of them. */
  nodeRef?: (node: Konva.Node | null) => void;
}

/** A point-placed plant's canvas footprint, shaped distinctly per
 * `Plant.growth_habit` instead of the generic circle every plant rendered
 * as regardless of how it actually grows (see the "render distinct plant
 * footprint shapes" backlog item). Shared between the editable canvas
 * (`PlantPlacementLayer`'s `PlantingMarker`) and the read-only View-tab
 * snapshot (`GardenSnapshotView`'s own marker) - both point-placed a
 * plant the same way before this, so both get the same shape mapping.
 *
 * `x`/`y` is always the shape's *center* (matching the `Circle` this
 * replaces) regardless of which case below renders - callers that read the
 * dragged position back off a Konva node (`node.x()`/`node.y()`) don't need
 * to know or care which shape is currently on screen. */
export function PlantFootprint({ growthHabit, x, y, radius, fill, opacity, stroke, strokeWidth, dash, nodeRef, ...events }: PlantFootprintProps) {
  const habit = normalizeHabit(growthHabit);

  switch (habit) {
    case "upright":
      // A narrow, upward-pointed diamond - grows in a tight column rather
      // than spreading out to fill its footprint (e.g. staked tomatoes, corn).
      return (
        <RegularPolygon
          ref={nodeRef}
          x={x}
          y={y}
          sides={4}
          radius={radius}
          rotation={45}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          {...events}
        />
      );
    case "climbing":
      // An upward-pointing triangle - reaches up a support (trellis, pole)
      // instead of occupying its footprint evenly (e.g. peas, pole beans).
      return (
        <RegularPolygon
          ref={nodeRef}
          x={x}
          y={y}
          sides={3}
          radius={radius * 1.15}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          {...events}
        />
      );
    case "spreading":
      // An 8-point star - spreads outward in multiple directions (runners,
      // sprawling stems) rather than staying compact (e.g. squash, strawberries).
      return (
        <Star
          ref={nodeRef}
          x={x}
          y={y}
          numPoints={8}
          innerRadius={radius * 0.55}
          outerRadius={radius}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          {...events}
        />
      );
    case "rosette":
      // A ring - a low cluster of leaves radiating from a center point
      // (e.g. lettuce, cabbage before it heads up).
      return (
        <Ring
          ref={nodeRef}
          x={x}
          y={y}
          innerRadius={radius * 0.4}
          outerRadius={radius}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          {...events}
        />
      );
    case "tree":
      // The one habit that isn't remotely low/circular, so it gets a
      // compound trunk+canopy glyph instead of a single primitive. `x`/`y`
      // stays the group's origin (= the stored planting center) even though
      // the icon itself isn't visually centered on it - the trunk grows
      // down and the canopy sits above, same as a real tree would from its
      // base position.
      return (
        <Group ref={nodeRef} x={x} y={y} {...events}>
          <Rect x={-radius * 0.12} y={0} width={radius * 0.24} height={radius} fill={stroke} listening={false} />
          <Circle y={-radius * 0.15} radius={radius * 0.75} fill={fill} opacity={opacity} stroke={stroke} strokeWidth={strokeWidth} dash={dash} />
        </Group>
      );
    default:
      return (
        <Circle
          ref={nodeRef}
          x={x}
          y={y}
          radius={radius}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          {...events}
        />
      );
  }
}
