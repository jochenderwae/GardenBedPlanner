import type { Viewport } from "./viewport";

/** Fixed padding (cm - these labels render in unscaled world-space text, see
 * BedNode.tsx/GardenBoundary.tsx/ExampleGardenView.tsx) between a label's
 * anchor point and the edge of the shape it's attached to. */
export const LABEL_PADDING_CM = 4;

/** Konva's `Text` default fontFamily (unset yields the canvas default
 * "Arial") - kept here so `measureTextWidth` below measures with the same
 * font metrics Konva itself renders labels with. */
const LABEL_FONT_FAMILY = "Arial, sans-serif";

let measureCanvas: HTMLCanvasElement | null = null;

/** Approximates the on-canvas rendered width (px) of `text` at `fontSizePx`
 * - used to decide whether a bed/garden name label got ellipsis-truncated
 * (Konva's `Text` + `ellipsis` truncates internally without reporting back
 * whether it actually did), so hover tooltips only appear for names that are
 * genuinely cut off rather than every label. Reuses one offscreen canvas
 * across calls instead of creating one per measurement. */
export function measureTextWidth(text: string, fontSizePx: number, fontFamily: string = LABEL_FONT_FAMILY): number {
  if (typeof document === "undefined") return text.length * fontSizePx * 0.6;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * fontSizePx * 0.6;
  ctx.font = `${fontSizePx}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

/** On-screen vertical clearance (px) a bed/garden name label's top must keep
 * from the top of the visible canvas viewport, so it never renders on top of
 * RulerLayer's `0m`/`1m`/... tick-label row - that row always sits at a
 * viewport-relative (not garden-relative) screen position, roughly the top
 * ~20px of whatever's currently visible, regardless of zoom (see
 * RulerLayer.tsx). */
const LABEL_RULER_CLEARANCE_PX = 20;

/** Nudges a label's world-space y down (never up) so it renders at least
 * `LABEL_RULER_CLEARANCE_PX` below the top of the current viewport, whatever
 * the current pan/zoom - fixes bed/garden name labels colliding with the
 * ruler's top tick-label row for shapes flush against (or, like the garden
 * boundary's own name, drawn above) the visible top edge. */
export function clampLabelYBelowRuler(worldY: number, viewport: Viewport): number {
  const minWorldY = (LABEL_RULER_CLEARANCE_PX - viewport.y) / viewport.scale;
  return Math.max(worldY, minWorldY);
}
