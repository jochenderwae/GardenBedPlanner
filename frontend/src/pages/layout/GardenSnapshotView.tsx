import type Konva from "konva";
import { useMemo } from "react";
import { Group, Layer, Rect, Text } from "react-konva";
import type { Bed, Plant, Planting } from "@/api/client";
import {
  boundingRect,
  colorForSlug,
  colorsForBedCategory,
  DEFAULT_PLANTING_DIAMETER_CM,
  fieldMarkerPositions,
  rectRenderProps,
  rowMarkerPositions,
} from "./geometry";
import { clampLabelYBelowRuler, LABEL_PADDING_CM, measureTextWidth } from "./labels";
import { PlantFootprint } from "./PlantFootprint";
import type { PlantingTooltipState } from "./PlantingTooltip";
import { DEFAULT_VIEWPORT, type Viewport } from "./viewport";

const BED_LABEL_FONT_SIZE = 12;

/** Read-only rendering of the user's *real* `Bed`/`Planting` data for a
 * given moment in time (#180) - the View tab's own content once its data
 * source moved off the canned `data/example_garden.json` demo fixture
 * (see the old `ExampleGardenView.tsx`, now retired). `plantings` is
 * expected to already be filtered by the caller (`Layout.tsx`'s date
 * scrubber, via `isPlantingActiveAsOf`) to whatever was actually in the
 * ground as of the selected date - this component only lays out whatever
 * it's handed, it doesn't do its own date filtering.
 *
 * Coordinate nesting matches `PlantPlacementLayer`'s editable canvas: one
 * `Group` per bed positioned in garden-space, plantings as children in that
 * Group's bed-local coordinates. Bed shape itself is simplified to its
 * axis-aligned bounding box regardless of rectangle/polygon (see
 * `boundingRect`'s own doc - this read-only-preview use is its named
 * rationale), matching the old example-garden view's same simplification.
 *
 * Renders only a `<Layer>` (must be a direct child of `<Stage>`) - the
 * hover tooltip is plain HTML and can't live inside the Konva tree, so it's
 * reported via `onHover` and rendered by the caller (`Layout.tsx`) as a
 * sibling of the Stage, via the shared `PlantingTooltip`. */
export function GardenSnapshotLayer({
  beds,
  plantings,
  plantsBySlug,
  onHover,
  viewport = DEFAULT_VIEWPORT,
}: {
  beds: Bed[];
  plantings: Planting[];
  plantsBySlug: Map<string, Plant>;
  onHover: (tooltip: PlantingTooltipState | null) => void;
  viewport?: Viewport;
}) {
  const plantingsByBed = useMemo(() => {
    const map = new Map<number, Planting[]>();
    for (const planting of plantings) {
      const list = map.get(planting.bed_id) ?? [];
      list.push(planting);
      map.set(planting.bed_id, list);
    }
    return map;
  }, [plantings]);

  return (
    <Layer>
      {beds
        .filter((bed): bed is Bed & { id: number } => bed.id != null)
        .map((bed) => (
          <SnapshotBedGroup
            key={bed.id}
            bed={bed}
            plantings={plantingsByBed.get(bed.id) ?? []}
            plantsBySlug={plantsBySlug}
            onHover={onHover}
            viewport={viewport}
          />
        ))}
    </Layer>
  );
}

function SnapshotBedGroup({
  bed,
  plantings,
  plantsBySlug,
  onHover,
  viewport,
}: {
  bed: Bed;
  plantings: Planting[];
  plantsBySlug: Map<string, Plant>;
  onHover: (tooltip: PlantingTooltipState | null) => void;
  viewport: Viewport;
}) {
  const colors = colorsForBedCategory(bed.category);
  const rect = boundingRect(bed.border_geometry);

  // Same width-clamp + truncation-gated hover tooltip as BedNode's own name
  // label (see #166) - this read-only snapshot has the identical
  // adjacent-beds-collide-with-each-other's-labels problem.
  const labelAvailableWidth = Math.max(0, rect.width - 2 * LABEL_PADDING_CM);
  const isNameTruncated = measureTextWidth(bed.name, BED_LABEL_FONT_SIZE) > labelAvailableWidth;
  const labelLocalY = clampLabelYBelowRuler(rect.y + LABEL_PADDING_CM, viewport) - rect.y;

  function showLabelTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isNameTruncated) return;
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHover({ x: e.evt.clientX - stageBox.left, y: e.evt.clientY - stageBox.top, title: bed.name, subtitle: "" });
  }

  return (
    <Group x={rect.x} y={rect.y}>
      <Rect
        width={rect.width}
        height={rect.height}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={1.5}
        opacity={0.85}
      />
      <Text
        x={LABEL_PADDING_CM}
        y={labelLocalY}
        text={bed.name}
        width={labelAvailableWidth}
        wrap="none"
        ellipsis
        fontSize={BED_LABEL_FONT_SIZE}
        fill="#1f2937"
        listening={isNameTruncated}
        onMouseEnter={showLabelTooltip}
        onMouseMove={showLabelTooltip}
        onMouseLeave={() => onHover(null)}
      />
      {plantings.map((planting) => (
        <SnapshotPlantingMarker
          key={planting.id}
          planting={planting}
          plant={plantsBySlug.get(planting.plant_slug)}
          onHover={onHover}
        />
      ))}
    </Group>
  );
}

/** A single planting's read-only footprint - shaped by its own
 * `placement_type` the same way `PlantPlacementLayer`'s editable
 * `PlantingMarker` is (point/row/area), just without any of the
 * drag/select/edit affordances (no `draggable`, no click handlers besides
 * the hover tooltip). */
function SnapshotPlantingMarker({
  planting,
  plant,
  onHover,
}: {
  planting: Planting;
  plant: Plant | undefined;
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  const color = colorForSlug(planting.plant_slug);
  const title = plant?.common_name ?? planting.plant_slug;
  const subtitle = plant?.botanical_name ?? "";

  function showTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHover({ x: e.evt.clientX - stageBox.left, y: e.evt.clientY - stageBox.top, title, subtitle });
  }

  const hoverEvents = {
    onMouseEnter: showTooltip,
    onMouseMove: showTooltip,
    onMouseLeave: () => onHover(null),
  };

  if (planting.placement_type === "row" || planting.placement_type === "field") {
    const props = rectRenderProps(planting.geometry);
    const effectiveSpacing = planting.spacing_cm ?? plant?.spread_cm ?? DEFAULT_PLANTING_DIAMETER_CM;
    const markerRadius = Math.max(3, effectiveSpacing / 2);
    const markerPositions =
      planting.placement_type === "row" ? rowMarkerPositions(props, effectiveSpacing) : fieldMarkerPositions(props, effectiveSpacing);

    return (
      <>
        {markerPositions.map((pos, i) => (
          <PlantFootprint
            key={i}
            growthHabit={plant?.growth_habit}
            x={pos.x}
            y={pos.y}
            radius={markerRadius}
            fill={color}
            opacity={0.75}
            stroke="#00000030"
            strokeWidth={1}
            {...hoverEvents}
          />
        ))}
      </>
    );
  }

  const rect = boundingRect(planting.geometry);
  const radius = Math.max(3, rect.width / 2);

  return (
    <PlantFootprint
      growthHabit={plant?.growth_habit}
      x={rect.x + rect.width / 2}
      y={rect.y + rect.height / 2}
      radius={radius}
      fill={color}
      opacity={0.75}
      stroke="#00000030"
      strokeWidth={1}
      {...hoverEvents}
    />
  );
}
