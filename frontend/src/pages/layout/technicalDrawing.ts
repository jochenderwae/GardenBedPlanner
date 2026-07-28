import { centeredSegments, distanceBetweenPoints, segmentCount } from "./geometry";

/** A single labeled dimension measurement between two bed-local (cm) points
 * - the technical drawing's (#193) core visual unit. `labelPos` defaults to
 * the line's own midpoint; kept as a separate field (rather than always
 * recomputed by the renderer) so a future caller could offset it without
 * this module needing to know why. */
export interface DimensionLine {
  from: { x: number; y: number };
  to: { x: number; y: number };
  distanceCm: number;
  labelPos: { x: number; y: number };
}

function makeDimensionLine(from: { x: number; y: number }, to: { x: number; y: number }): DimensionLine {
  return {
    from,
    to,
    distanceCm: distanceBetweenPoints(from, to),
    labelPos: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
  };
}

/** Dimension lines from a bed's own left (x=0) and top (y=0) edges to a
 * single marker's center - "how far is this plant from the bed's own
 * edge," the core requirement #193 exists for. Both lines run parallel to a
 * bed axis (not a direct diagonal to the corner) so each reads as a
 * single-axis tape-measure reading, matching how a gardener would actually
 * measure on site - never a garden-absolute position (the caller is
 * expected to already be working in the bed's own local coordinate space,
 * same as `Planting.geometry` itself - see `backend/app/models/
 * planting.py`'s own doc on that). */
export function bedEdgeDimensionLines(marker: { x: number; y: number }): {
  horizontal: DimensionLine;
  vertical: DimensionLine;
} {
  return {
    horizontal: makeDimensionLine({ x: 0, y: marker.y }, marker),
    vertical: makeDimensionLine({ x: marker.x, y: 0 }, marker),
  };
}

/** Dimension line between every consecutive pair of markers - "distance
 * between plants" for a `row` placement's own markers, already laid out
 * along the row's own axis by `geometry.ts`'s `rowMarkerPositions`. */
export function adjacentMarkerDimensionLines(positions: { x: number; y: number }[]): DimensionLine[] {
  const lines: DimensionLine[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    lines.push(makeDimensionLine(positions[i], positions[i + 1]));
  }
  return lines;
}

/** One representative "between plants" (along the first row) and one
 * "between rows" (along the first column) dimension line for a `field`
 * placement's grid of markers - not every pairwise gap, since a uniform
 * grid repeats the same `spacingCm` value across every gap on a given axis
 * and drawing all of them would only add clutter, not information. Field
 * geometry is always axis-aligned (see `geometry.ts`'s
 * `fieldGeometryFromDrag`), so this adds `geometry.x`/`geometry.y` directly
 * rather than routing through the rotation-aware point transform
 * `fieldMarkerPositions` itself uses internally. */
export function fieldSpacingDimensionLines(
  geometry: { x: number; y: number; width: number; height: number },
  spacingCm: number,
): DimensionLine[] {
  const xs = centeredSegments(geometry.width, segmentCount(geometry.width, spacingCm));
  const ys = centeredSegments(geometry.height, segmentCount(geometry.height, spacingCm));
  const lines: DimensionLine[] = [];
  if (xs.length > 1) {
    const y = geometry.y + ys[0];
    lines.push(makeDimensionLine({ x: geometry.x + xs[0], y }, { x: geometry.x + xs[1], y }));
  }
  if (ys.length > 1) {
    const x = geometry.x + xs[0];
    lines.push(makeDimensionLine({ x, y: geometry.y + ys[0] }, { x, y: geometry.y + ys[1] }));
  }
  return lines;
}

/** One dimension line per marker to its own nearest *other* marker,
 * deduplicated so a mutual nearest-neighbor pair (the common case) only
 * draws once - lets individually-placed plants in the same bed show a
 * direct "distance between plants" line without needing to be part of the
 * same `row`/`field` placement the way `adjacentMarkerDimensionLines`/
 * `fieldSpacingDimensionLines` require. O(n^2), fine at a single bed's own
 * planting count. */
export function nearestNeighborDimensionLines(markers: { x: number; y: number }[]): DimensionLine[] {
  const nearestIndexByMarker = new Map<number, number>();
  for (let i = 0; i < markers.length; i++) {
    let nearestIndex = -1;
    let nearestDist = Infinity;
    for (let j = 0; j < markers.length; j++) {
      if (i === j) continue;
      const dist = distanceBetweenPoints(markers[i], markers[j]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = j;
      }
    }
    if (nearestIndex !== -1) nearestIndexByMarker.set(i, nearestIndex);
  }

  const seenPairs = new Set<string>();
  const lines: DimensionLine[] = [];
  for (const [i, j] of nearestIndexByMarker) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    lines.push(makeDimensionLine(markers[i], markers[j]));
  }
  return lines;
}
