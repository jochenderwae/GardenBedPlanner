import { Layer, Line, Text } from "react-konva";
import { formatDistanceCm } from "./geometry";

const TICK_SPACING_CM = 100;
const TICK_LENGTH_PX = 6;

interface RulerLayerProps {
  widthCm: number;
  heightCm: number;
}

/** One-meter tick marks along the top and left edges, in the same
 * coordinate space as GridLines/BedNode (no offset of its own - shifting
 * the whole canvas to make room for a ruler gutter would mean threading a
 * margin through every other layer's drag/snap math, not worth it for tick
 * labels). Labeled via formatDistanceCm (metric only for now - see that
 * function's own comment on the imperial-later plan). Non-interactive
 * (listening={false}) so it never intercepts drags meant for beds/plants
 * underneath. */
export function RulerLayer({ widthCm, heightCm }: RulerLayerProps) {
  const xTicks = [];
  for (let x = 0; x <= widthCm; x += TICK_SPACING_CM) {
    xTicks.push(<Line key={`xt${x}`} points={[x, 0, x, TICK_LENGTH_PX]} stroke="#374151" strokeWidth={1} />);
    xTicks.push(
      <Text key={`xl${x}`} x={x + 2} y={TICK_LENGTH_PX + 1} text={formatDistanceCm(x)} fontSize={10} fill="#374151" />,
    );
  }
  const yTicks = [];
  for (let y = 0; y <= heightCm; y += TICK_SPACING_CM) {
    yTicks.push(<Line key={`yt${y}`} points={[0, y, TICK_LENGTH_PX, y]} stroke="#374151" strokeWidth={1} />);
    yTicks.push(
      <Text key={`yl${y}`} x={TICK_LENGTH_PX + 2} y={y + 2} text={formatDistanceCm(y)} fontSize={10} fill="#374151" />,
    );
  }
  return (
    <Layer listening={false}>
      {xTicks}
      {yTicks}
    </Layer>
  );
}
