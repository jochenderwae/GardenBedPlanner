import { Layer, Line, Text } from "react-konva";
import { formatDistanceCm } from "./geometry";
import { pickTickSpacingCm, visibleWorldBounds, type Size, type Viewport } from "./viewport";

const TICK_LENGTH_PX = 6;

interface RulerLayerProps {
  /** Screen-px size of the visible canvas viewport (not the world/garden
   * size) - used with `viewport` to figure out which world-space range is
   * actually on screen right now. */
  canvasSize: Size;
  viewport: Viewport;
}

/** One-tick-per-`pickTickSpacingCm` marks along the top and left edges of
 * whatever's currently visible (not a fixed 0..canvas-size world range -
 * see `visibleWorldBounds`), so panning/zooming keeps the ruler meaningful
 * instead of running out partway through a large garden. Ticks live in the
 * same world/cm coordinate space as GridLines/BedNode (this layer is a
 * sibling `Layer` under the same scaled/panned `Stage`, so it inherits the
 * pan/zoom transform automatically) - stroke width and font size are
 * divided by `viewport.scale` so they read as a constant on-screen size
 * regardless of zoom level, the same way a real ruler's markings don't get
 * thinner as you zoom out. Non-interactive (listening={false}) so it never
 * intercepts drags meant for beds/plants underneath - callers should still
 * render it as the *last* child of the `Stage` (topmost Konva Layer) so
 * opaque bed/garden-boundary fills don't visually cover its ticks whenever
 * panning brings that content across the screen edges the ruler is anchored
 * to (see the "Left tick marks disappear" backlog item). */
export function RulerLayer({ canvasSize, viewport }: RulerLayerProps) {
  const bounds = visibleWorldBounds(viewport, canvasSize);
  const spacing = pickTickSpacingCm(viewport.scale);
  const strokeWidth = 1 / viewport.scale;
  const tickLength = TICK_LENGTH_PX / viewport.scale;
  const fontSize = 10 / viewport.scale;

  const startX = Math.floor(bounds.x / spacing) * spacing;
  const endX = bounds.x + bounds.width;
  const startY = Math.floor(bounds.y / spacing) * spacing;
  const endY = bounds.y + bounds.height;

  const xTicks = [];
  for (let x = startX; x <= endX; x += spacing) {
    xTicks.push(
      <Line
        key={`xt${x}`}
        points={[x, bounds.y, x, bounds.y + tickLength]}
        stroke="#374151"
        strokeWidth={strokeWidth}
      />,
    );
    xTicks.push(
      <Text
        key={`xl${x}`}
        x={x + strokeWidth * 2}
        y={bounds.y + tickLength + strokeWidth}
        text={formatDistanceCm(x)}
        fontSize={fontSize}
        fill="#374151"
      />,
    );
  }
  const yTicks = [];
  for (let y = startY; y <= endY; y += spacing) {
    yTicks.push(
      <Line
        key={`yt${y}`}
        points={[bounds.x, y, bounds.x + tickLength, y]}
        stroke="#374151"
        strokeWidth={strokeWidth}
      />,
    );
    yTicks.push(
      <Text
        key={`yl${y}`}
        x={bounds.x + tickLength + strokeWidth * 2}
        y={y + strokeWidth}
        text={formatDistanceCm(y)}
        fontSize={fontSize}
        fill="#374151"
      />,
    );
  }
  return (
    <Layer listening={false}>
      {xTicks}
      {yTicks}
    </Layer>
  );
}
