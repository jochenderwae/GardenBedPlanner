import type { ReactNode } from "react";
import type Konva from "konva";
import { Circle, Layer, Line, Rect, Text } from "react-konva";
import type { Bed, Plant, Planting } from "@/api/client";
import {
  boundingRect,
  colorForSlug,
  colorsForBedCategory,
  effectivePlantSpacing,
  effectiveRowSpacing,
  fieldMarkerPositions,
  formatDistanceCm,
  rectRenderProps,
  rowMarkerPositions,
} from "./geometry";
import { measureTextWidth } from "./labels";
import { PlantFootprint } from "./PlantFootprint";
import type { PlantingTooltipState } from "./PlantingTooltip";
import {
  adjacentMarkerDimensionLines,
  bedEdgeDimensionLines,
  fieldSpacingDimensionLines,
  nearestNeighborDimensionLines,
  type DimensionLine,
} from "./technicalDrawing";
import { DEFAULT_VIEWPORT, type Viewport } from "./viewport";

const DIMENSION_COLOR = "#b45309";
const BED_LABEL_FONT_SIZE = 12;
const DIMENSION_FONT_SIZE = 10;

function markerHoverHandlers(onHover: (tooltip: PlantingTooltipState | null) => void, title: string, subtitle: string) {
  function showTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHover({ x: e.evt.clientX - stageBox.left, y: e.evt.clientY - stageBox.top, title, subtitle });
  }
  return {
    onMouseEnter: showTooltip,
    onMouseMove: showTooltip,
    onMouseLeave: () => onHover(null),
  };
}

/** One planting's rendered markers (reusing `PlantFootprint`'s growth-habit
 * shapes, same as `GardenSnapshotView.tsx`) plus the dimension lines it
 * contributes - bed-edge lines for its first/only marker always, and either
 * "between plants" (row) or "between rows"+"between plants" (field) lines
 * from its own internal spacing. Individually-placed plantings only
 * contribute their bed-edge lines here; their own "distance to the nearest
 * other plant" line is computed once across every individual planting in
 * the bed by the caller (see `individualCenters` below), not per-planting. */
function plantingDrawing(
  planting: Planting,
  plant: Plant | undefined,
  onHover: (tooltip: PlantingTooltipState | null) => void,
): { markers: ReactNode[]; dimensionLines: DimensionLine[]; individualCenter: { x: number; y: number } | null } {
  const color = colorForSlug(planting.plant_slug);
  const title = plant?.common_name ?? planting.plant_slug;
  const subtitle = plant?.botanical_name ?? "";
  const hoverEvents = markerHoverHandlers(onHover, title, subtitle);

  if (planting.placement_type === "row" || planting.placement_type === "field") {
    const props = rectRenderProps(planting.geometry);
    const effectiveSpacing = effectivePlantSpacing(planting.spacing_cm, plant);
    const effectiveRowSpacingCm = effectiveRowSpacing(planting.row_spacing_cm, plant);
    const markerRadius = Math.max(3, effectiveSpacing / 2);
    const positions =
      planting.placement_type === "row"
        ? rowMarkerPositions(props, effectiveSpacing)
        : fieldMarkerPositions(props, effectiveSpacing, effectiveRowSpacingCm);

    const markers = positions.map((pos, i) => (
      <PlantFootprint
        key={`${planting.id}-${i}`}
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
    ));

    const dimensionLines: DimensionLine[] = [];
    if (positions.length > 0) {
      const edges = bedEdgeDimensionLines(positions[0]);
      dimensionLines.push(edges.horizontal, edges.vertical);
    }
    dimensionLines.push(
      ...(planting.placement_type === "row"
        ? adjacentMarkerDimensionLines(positions)
        : fieldSpacingDimensionLines(props, effectiveSpacing, effectiveRowSpacingCm)),
    );
    return { markers, dimensionLines, individualCenter: null };
  }

  const rect = boundingRect(planting.geometry);
  const radius = Math.max(3, rect.width / 2);
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const edges = bedEdgeDimensionLines(center);
  return {
    markers: [
      <PlantFootprint
        key={planting.id}
        growthHabit={plant?.growth_habit}
        x={center.x}
        y={center.y}
        radius={radius}
        fill={color}
        opacity={0.75}
        stroke="#00000030"
        strokeWidth={1}
        {...hoverEvents}
      />,
    ],
    dimensionLines: [edges.horizontal, edges.vertical],
    individualCenter: center,
  };
}

/** One dimension line's dashed guide + endpoint dots + centered distance
 * label. `px` is `1 / viewport.scale` - every pixel-ish constant below is
 * multiplied by it so strokes/dots/text read as a constant on-screen size
 * regardless of zoom, the same compensation `BedNode`/`RulerLayer` already
 * apply for their own live dimension readouts. */
function DimensionAnnotation({ line, px }: { line: DimensionLine; px: number }) {
  const fontSize = DIMENSION_FONT_SIZE * px;
  const label = formatDistanceCm(line.distanceCm);
  const labelWidth = measureTextWidth(label, fontSize);
  return (
    <>
      <Line
        points={[line.from.x, line.from.y, line.to.x, line.to.y]}
        stroke={DIMENSION_COLOR}
        strokeWidth={px}
        dash={[4 * px, 3 * px]}
        listening={false}
      />
      <Circle x={line.from.x} y={line.from.y} radius={2 * px} fill={DIMENSION_COLOR} listening={false} />
      <Circle x={line.to.x} y={line.to.y} radius={2 * px} fill={DIMENSION_COLOR} listening={false} />
      <Text
        x={line.labelPos.x - labelWidth / 2}
        y={line.labelPos.y - fontSize / 2}
        text={label}
        fontSize={fontSize}
        fill={DIMENSION_COLOR}
        listening={false}
      />
    </>
  );
}

/** Read-only, bed-relative "technical drawing" for a single bed (#193):
 * every one of its plantings rendered in the bed's own local coordinate
 * space and annotated with dimension lines/labels, so a gardener can
 * execute a task ("sow 12cm from this edge, rows 20cm apart") without
 * needing to know the bed's position in the wider garden at all.
 * `Planting.geometry` is already bed-local (see `backend/app/models/
 * planting.py`'s own doc), so the bed itself is drawn at local origin
 * (0,0) - unlike `GardenSnapshotView.tsx`, which nests the same bed-local
 * plantings inside a Group positioned at the bed's *world* coordinates for
 * the whole-garden view, this component drops that outer offset entirely:
 * bed-local IS the rendered coordinate space here, no translation needed.
 *
 * Renders only a `<Layer>` (must be a direct child of `<Stage>`) - hover
 * tooltips are plain HTML, reported via `onHover` for the caller to render
 * as a `PlantingTooltip` sibling of the Stage, same convention every other
 * layer in this app follows. */
export function TechnicalDrawingLayer({
  bed,
  plantings,
  plantsBySlug,
  onHover,
  viewport = DEFAULT_VIEWPORT,
}: {
  bed: Bed;
  plantings: Planting[];
  plantsBySlug: Map<string, Plant>;
  onHover: (tooltip: PlantingTooltipState | null) => void;
  viewport?: Viewport;
}) {
  const bedRect = boundingRect(bed.border_geometry);
  const colors = colorsForBedCategory(bed.category);
  const px = 1 / viewport.scale;

  const drawings = plantings.map((planting) => plantingDrawing(planting, plantsBySlug.get(planting.plant_slug), onHover));
  const markers = drawings.flatMap((d) => d.markers);
  const individualCenters = drawings.map((d) => d.individualCenter).filter((c): c is { x: number; y: number } => c != null);
  const dimensionLines = [
    ...drawings.flatMap((d) => d.dimensionLines),
    ...nearestNeighborDimensionLines(individualCenters),
  ];

  return (
    <Layer>
      <Rect
        x={0}
        y={0}
        width={bedRect.width}
        height={bedRect.height}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={1.5 * px}
        opacity={0.9}
        listening={false}
      />
      <Text
        x={0}
        y={-(BED_LABEL_FONT_SIZE * px) - 4 * px}
        text={`${bed.name} — ${formatDistanceCm(bedRect.width)} × ${formatDistanceCm(bedRect.height)}`}
        fontSize={BED_LABEL_FONT_SIZE * px}
        fill="#1f2937"
        listening={false}
      />
      {dimensionLines.map((line, i) => (
        <DimensionAnnotation key={i} line={line} px={px} />
      ))}
      {markers}
    </Layer>
  );
}
