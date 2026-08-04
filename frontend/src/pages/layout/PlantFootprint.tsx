import type Konva from "konva";
import { Circle, Group, Rect, RegularPolygon, Ring } from "react-konva";
import type { Geometry, PlacementType, Plant } from "@/api/client";
import { colorForSlug, plantingMarkerPositions } from "./geometry";

/** The ETL's authored vocabulary (`data/plant.schema.json`'s own
 * `growth_habit` enum) - not enforced as a real enum at the API layer
 * (`Plant.growth_habit` is plain `string | null`), so this is only used as
 * a lookup key set, never assumed to be the full range of values that
 * could show up. */
export const KNOWN_HABITS = ["upright", "spreading", "climbing", "rosette", "tree"] as const;
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
  /** Omit entirely (rather than passing `"transparent"`) for an unfilled,
   * stroke-only outline - Konva's own idiom for "no fill", used by
   * `SpreadOutline` below. */
  fill?: string;
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
    case "upright": {
      // A narrow, rounded-end vertical capsule - grows in a tight column
      // rather than spreading out to fill its footprint (e.g. staked
      // tomatoes, corn). Replaced the diamond this used to be (#259) - a
      // 4-sided polygon sitting next to the other angular shapes read as one
      // more spike in the vocabulary; a capsule has zero sharp corners.
      const width = radius * 0.8;
      const height = radius * 2;
      return (
        <Rect
          ref={nodeRef}
          x={x}
          y={y}
          offsetX={width / 2}
          offsetY={height / 2}
          width={width}
          height={height}
          cornerRadius={width / 2}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          {...events}
        />
      );
    }
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
    case "spreading": {
      // A trefoil - three equal circles arranged 120° apart around the
      // center, spreading outward in multiple directions (runners, sprawling
      // stems) rather than staying compact (e.g. squash, strawberries).
      // Replaced the 8-point star this used to be (#259) - 16 spiky line
      // segments turned into a scribble once several mature-size outlines
      // overlapped; all-curves-no-straight-edges reads as soft overlapping
      // circles instead. Same Group-of-primitives pattern the `tree` case
      // below already establishes.
      const petalRadius = radius * 0.6;
      const petalOffset = radius * 0.4;
      const petalAngles = [-90, 30, 150]; // degrees, 120° apart, one pointed up
      return (
        <Group ref={nodeRef} x={x} y={y} {...events}>
          {petalAngles.map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return (
              <Circle
                key={deg}
                x={Math.cos(rad) * petalOffset}
                y={Math.sin(rad) * petalOffset}
                radius={petalRadius}
                fill={fill}
                opacity={opacity}
                stroke={stroke}
                strokeWidth={strokeWidth}
                dash={dash}
              />
            );
          })}
        </Group>
      );
    }
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
          {/* #259: was missing opacity, so the trunk stayed fully opaque even
              in SpreadOutline's translucent-outline mode, unlike the canopy
              right below it (and every other habit) which already fades
              correctly. */}
          <Rect x={-radius * 0.12} y={0} width={radius * 0.24} height={radius} fill={stroke} opacity={opacity} listening={false} />
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

// Deliberately below the solid marker's own 0.85 (edit)/0.75 (read-only)
// opacity so a spread outline always reads as background/secondary,
// regardless of which view it's drawn in - see #173's design spec.
const SPREAD_OUTLINE_OPACITY = 0.3;
const SPREAD_OUTLINE_STROKE_WIDTH_CM = 1;

/** A plant's mature-size footprint, drawn as a thin, unfilled, non-
 * interactive outline "behind" its solid marker(s) - see #173's design
 * spec (the ticket this implements). Sized off `Plant.spread_cm` (how big
 * the plant actually gets), deliberately not `effectivePlantSpacing`/
 * `defaultPlantSpacing` (the *planting-distance* recommendation the solid
 * marker itself is already sized to) - those two numbers legitimately
 * differ, and reusing the marker's own spacing here would just draw two
 * near-identical shapes instead of showing anything new.
 *
 * Renders once per marker position (`plantingMarkerPositions` - the same
 * grid `PlantingMarker`/`SnapshotPlantingMarker` place their own solid
 * markers at for a row/field planting, or the single center point for an
 * individual one), never one outline spanning a whole row/field rectangle -
 * `spread_cm` is inherently a per-plant measure.
 *
 * Callers must render every bed's `SpreadOutline`s in their own pass
 * *before* every bed's solid markers (a "two-pass" render order, not
 * interleaved per-planting) so a low-opacity outline can never visually
 * cover a neighboring plant's actual marker where footprints overlap - see
 * `PlantPlacementLayer`/`GardenSnapshotView`'s own render order comments. */
export function SpreadOutline({
  placementType,
  geometry,
  spacingCm,
  plant,
  slug,
}: {
  placementType: PlacementType;
  geometry: Geometry;
  spacingCm: number | null | undefined;
  plant: Plant | undefined;
  slug: string;
}) {
  const spreadCm = plant?.spread_cm;
  // No fallback to a default size when unknown (unlike the solid marker's
  // own DEFAULT_PLANTING_DIAMETER_CM, which exists purely so an unsized
  // marker is still visible/clickable) - a placeholder-sized ring here would
  // imply false precision about a real biological measurement that just
  // isn't on file. Omitting the outline entirely is the graceful fallback.
  if (spreadCm == null || spreadCm <= 0) return null;
  const radius = spreadCm / 2;
  const stroke = colorForSlug(slug);
  const positions = plantingMarkerPositions(placementType, geometry, spacingCm, plant);
  return (
    <>
      {positions.map((pos, i) => (
        <PlantFootprint
          key={i}
          growthHabit={plant?.growth_habit}
          x={pos.x}
          y={pos.y}
          radius={radius}
          stroke={stroke}
          strokeWidth={SPREAD_OUTLINE_STROKE_WIDTH_CM}
          opacity={SPREAD_OUTLINE_OPACITY}
          listening={false}
        />
      ))}
    </>
  );
}
