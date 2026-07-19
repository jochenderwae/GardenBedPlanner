/** Pure pan/zoom math for the canvas editor's `Stage` - kept separate from
 * `Layout.tsx`'s Konva wiring so it stays unit-testable without touching
 * Konva/DOM at all (see product-owner/research/canvas-editor-cad-lessons.md
 * phase 1). `Viewport` mirrors what a Konva `Stage` needs directly: `x`/`y`
 * are the stage's own position (screen px), `scale` applies to both axes
 * uniformly - this editor has no reason to support independent x/y zoom. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Point, Size {}

/** Clamp a scale factor to a sane zoom range - shared by the wheel-zoom
 * handler and `fitViewport` below so neither can produce a scale so small
 * the garden becomes a speck or so large it's all off-screen. */
export function clampScale(scale: number, min: number = MIN_SCALE, max: number = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

/** Screen (stage-container-relative) pixel -> world (cm) coordinate, given
 * the stage's current pan/zoom. */
export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

/** World (cm) coordinate -> screen (stage-container-relative) pixel, given
 * the stage's current pan/zoom - inverse of `screenToWorld`. */
export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

/** Pointer-relative zoom step: given the current viewport, the world point
 * under the pointer, the pointer's screen position, and a target scale,
 * returns the viewport that keeps that world point fixed under the pointer
 * (the standard Konva/Figma pointer-relative wheel-zoom pattern). */
export function zoomAtPoint(viewport: Viewport, pointerScreen: Point, nextScaleRaw: number): Viewport {
  const nextScale = clampScale(nextScaleRaw);
  const worldPoint = screenToWorld(pointerScreen, viewport);
  return {
    scale: nextScale,
    x: pointerScreen.x - worldPoint.x * nextScale,
    y: pointerScreen.y - worldPoint.y * nextScale,
  };
}

/** Compute a viewport that fits every box in `boxes` (world/cm coordinates,
 * e.g. bed/garden bounding rects) inside `canvasSize` (screen px) with a
 * fixed pixel margin - the "fit to garden" action. Falls back to the
 * default 100% viewport when there's nothing to fit. */
export function fitViewport(boxes: Box[], canvasSize: Size, marginPx: number = 40): Viewport {
  if (boxes.length === 0) return DEFAULT_VIEWPORT;

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  const availableWidth = Math.max(1, canvasSize.width - marginPx * 2);
  const availableHeight = Math.max(1, canvasSize.height - marginPx * 2);

  const scale = clampScale(Math.min(availableWidth / contentWidth, availableHeight / contentHeight));

  const x = marginPx + (availableWidth - contentWidth * scale) / 2 - minX * scale;
  const y = marginPx + (availableHeight - contentHeight * scale) / 2 - minY * scale;

  return { x, y, scale };
}

/** The world-space rectangle currently visible inside a `canvasSize`-sized
 * stage viewport - used by the ruler/grid to only draw ticks/lines across
 * what's actually on screen instead of a fixed pre-zoom/pan world extent. */
export function visibleWorldBounds(viewport: Viewport, canvasSize: Size): Box {
  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToWorld({ x: canvasSize.width, y: canvasSize.height }, viewport);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/** "Nice" world-space (cm) tick/grid-line spacings to choose between as zoom
 * changes - mirrors how CAD/floorplan rulers avoid both illegibly-dense and
 * uselessly-sparse tick marks at extreme zoom levels. */
const NICE_SPACINGS_CM = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** Pick the smallest "nice" spacing (cm) whose on-screen spacing at the
 * given zoom is still >= `targetScreenSpacingPx` - so ticks stay roughly
 * evenly spaced on screen regardless of zoom level. */
export function pickTickSpacingCm(scale: number, targetScreenSpacingPx: number = 80): number {
  const idealWorldSpacing = targetScreenSpacingPx / scale;
  for (const spacing of NICE_SPACINGS_CM) {
    if (spacing >= idealWorldSpacing) return spacing;
  }
  return NICE_SPACINGS_CM[NICE_SPACINGS_CM.length - 1];
}
