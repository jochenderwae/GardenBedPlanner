import { Circle, Group, Line, RegularPolygon, Wedge } from "react-konva";
import { normalizePartTypeKey } from "./irrigationPartTypes";

// #252's own vector-icon requirement, without a real icon asset set to draw
// from yet (`IrrigationPartType.icon_key` is an opaque placeholder string -
// see that schema's own docstring, "the actual icon set doesn't exist yet").
// Rather than block the whole ticket on that asset pipeline, this draws a
// small fixed set of recognizable Konva shapes keyed off the same normalized
// `part_type` free text `PipeNetworkDialog.tsx`'s own `PART_TYPE_SUGGESTIONS`
// datalist already offers - independent of whether a matching
// `IrrigationPartType` catalog row exists at all, so it renders correctly
// even before any resource pack is seeded. Unrecognized types fall back to
// no icon (the node's plain rounded-rect body, same "no rendered default but
// still works" precedent as everywhere else this project matches free text
// against an optional catalog).

const ICON_STROKE = "#334155"; // slate-700 - distinct from NODE_STROKE's teal so the icon reads as "what this part physically is", independent of the diagram's own selection/connection color vocabulary.

/** ~18x18, centered at (0, 0) - callers position via an enclosing `Group`. */
export function PartTypeIcon({ partType }: { partType: string }) {
  switch (normalizePartTypeKey(partType)) {
    case "nozzle":
      return (
        <Group listening={false}>
          <RegularPolygon sides={3} radius={6} rotation={180} y={-2} stroke={ICON_STROKE} strokeWidth={1.3} />
          <Circle radius={1} fill={ICON_STROKE} x={-3} y={7} />
          <Circle radius={1} fill={ICON_STROKE} x={0} y={9} />
          <Circle radius={1} fill={ICON_STROKE} x={3} y={7} />
        </Group>
      );
    case "t_junction":
      return (
        <Group listening={false}>
          <Line points={[-8, 0, 8, 0]} stroke={ICON_STROKE} strokeWidth={2} lineCap="round" />
          <Line points={[0, 0, 0, 8]} stroke={ICON_STROKE} strokeWidth={2} lineCap="round" />
        </Group>
      );
    case "connector":
      return (
        <Group listening={false}>
          <Line points={[-8, 0, 8, 0]} stroke={ICON_STROKE} strokeWidth={2} lineCap="round" />
          <Line points={[-2, -3, -2, 3]} stroke={ICON_STROKE} strokeWidth={1.3} />
          <Line points={[2, -3, 2, 3]} stroke={ICON_STROKE} strokeWidth={1.3} />
        </Group>
      );
    case "valve":
      return (
        <Group listening={false}>
          <Line points={[-8, 0, 8, 0]} stroke={ICON_STROKE} strokeWidth={2} lineCap="round" />
          <Circle radius={5} stroke={ICON_STROKE} strokeWidth={1.3} />
          <Line points={[-3, -3, 3, 3]} stroke={ICON_STROKE} strokeWidth={1.3} />
        </Group>
      );
    case "hose_segment":
      return (
        <Group listening={false}>
          <Line points={[-8, -2, -3, 3, 3, -3, 8, 2]} stroke={ICON_STROKE} strokeWidth={1.6} tension={0.5} lineCap="round" />
        </Group>
      );
    case "micro_tube":
      return (
        <Group listening={false}>
          <Line points={[-8, 0, 8, 0]} stroke={ICON_STROKE} strokeWidth={1} lineCap="round" />
        </Group>
      );
    case "end_cap":
      return (
        <Group listening={false} rotation={90}>
          <Wedge radius={6} angle={180} fill={ICON_STROKE} />
        </Group>
      );
    case "dripper":
      return (
        <Group listening={false}>
          <Circle radius={4.5} stroke={ICON_STROKE} strokeWidth={1.3} y={-2} />
          <RegularPolygon sides={3} radius={2.5} rotation={180} y={6} fill={ICON_STROKE} />
        </Group>
      );
    case "stake":
      return (
        <Group listening={false}>
          <Line points={[0, -8, 0, 4]} stroke={ICON_STROKE} strokeWidth={1.6} lineCap="round" />
          <Line points={[-3, 4, 3, 4, 0, 9]} closed fill={ICON_STROKE} />
        </Group>
      );
    default:
      return null;
  }
}
