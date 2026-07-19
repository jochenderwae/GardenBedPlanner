import type Konva from "konva";
import { Circle, Group, Layer, Rect, Text } from "react-konva";
import type { ExampleBed, ExamplePlanting, Plant } from "@/api/client";
import { boundingRect, colorForSlug, colorsForBedCategory, DEFAULT_PLANTING_DIAMETER_CM } from "./geometry";

export interface PlantingTooltipState {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}

/** Read-only preview of data/example_garden.json - beds and plant
 * placements, neither backed by a mutable API (no BedPlanting model exists
 * yet - see product-owner/research/wysiwyg-bed-editor.md's phase 2), so
 * nothing here is draggable/resizable/persisted. Coordinate nesting matches
 * docs/schema.md's design: one Group per bed positioned in garden-space,
 * plantings as children in that Group's bed-local coordinates.
 *
 * Renders only a `<Layer>` (must be a direct child of `<Stage>`, same as
 * every other layer) - the hover tooltip is plain HTML and can't live
 * inside the Konva tree, so it's reported via `onHover` and rendered by
 * the caller (Layout.tsx) as a sibling of the Stage instead. */
export function ExampleGardenLayer({
  beds,
  plantsBySlug,
  onHover,
}: {
  beds: ExampleBed[];
  plantsBySlug: Map<string, Plant>;
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  return (
    <Layer>
      {beds.map((bed, i) => (
        <ExampleBedGroup key={`${bed.name}-${i}`} bed={bed} plantsBySlug={plantsBySlug} onHover={onHover} />
      ))}
    </Layer>
  );
}

/** Plain HTML overlay for the currently-hovered planting - renders as a
 * sibling of the Konva `<Stage>`, positioned absolutely over it. */
export function PlantingTooltip({ tooltip }: { tooltip: PlantingTooltipState | null }) {
  if (!tooltip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
    >
      <div className="font-medium">{tooltip.title}</div>
      {tooltip.subtitle && <div className="text-muted-foreground italic">{tooltip.subtitle}</div>}
    </div>
  );
}

function ExampleBedGroup({
  bed,
  plantsBySlug,
  onHover,
}: {
  bed: ExampleBed;
  plantsBySlug: Map<string, Plant>;
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  const colors = colorsForBedCategory(bed.category);
  const rect = boundingRect(bed.border_geometry);

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
      <Text x={4} y={4} text={bed.name} fontSize={12} fill="#1f2937" listening={false} />
      {bed.plantings.map((planting, i) => (
        <PlantingDot
          key={`${planting.plant_slug}-${i}`}
          planting={planting}
          plant={plantsBySlug.get(planting.plant_slug)}
          onHover={onHover}
        />
      ))}
    </Group>
  );
}

function PlantingDot({
  planting,
  plant,
  onHover,
}: {
  planting: ExamplePlanting;
  plant: Plant | undefined;
  onHover: (tooltip: PlantingTooltipState | null) => void;
}) {
  const diameterCm = plant?.spread_cm ?? plant?.row_spacing_cm ?? DEFAULT_PLANTING_DIAMETER_CM;
  const radius = Math.max(3, diameterCm / 2);
  const color = colorForSlug(planting.plant_slug);
  const title = plant?.common_name ?? planting.plant_slug;
  const subtitle = plant?.botanical_name ?? "";

  function showTooltip(e: Konva.KonvaEventObject<MouseEvent>) {
    const stageBox = e.target.getStage()?.container().getBoundingClientRect();
    if (!stageBox) return;
    onHover({
      x: e.evt.clientX - stageBox.left,
      y: e.evt.clientY - stageBox.top,
      title,
      subtitle,
    });
  }

  return (
    <Circle
      x={planting.x_cm}
      y={planting.y_cm}
      radius={radius}
      fill={color}
      opacity={0.75}
      stroke="#00000030"
      strokeWidth={1}
      onMouseEnter={showTooltip}
      onMouseMove={showTooltip}
      onMouseLeave={() => onHover(null)}
    />
  );
}
