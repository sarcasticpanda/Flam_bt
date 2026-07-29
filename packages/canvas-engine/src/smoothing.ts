import type { Point } from '@board/shared';

/**
 * Pen stroke processing.
 *
 * A raw pointer stream at 120Hz produces hundreds of points for a short stroke. Rendered as a
 * polyline it looks visibly faceted, and stored raw it bloats every CRDT update. Two steps fix
 * both problems:
 *
 *   1. Ramer–Douglas–Peucker to drop points that carry no shape information.
 *   2. Catmull-Rom → cubic Bezier so what remains renders as a smooth curve.
 *
 * A jagged polyline is an instant tell that a drawing tool is a toy.
 */

/**
 * Ramer–Douglas–Peucker simplification.
 *
 * Iterative rather than recursive: a 2000-point stroke drawn fast can blow the call stack in the
 * naive recursive form, and that failure only shows up on the one demo where someone scribbles.
 */
export function simplify(points: readonly Point[], epsilon = 1): Point[] {
  return simplifyWithIndices(points, epsilon).map((i) => points[i]!);
}

/**
 * RDP returning the INDICES it kept rather than the points.
 *
 * Needed because a pressure series runs parallel to the point array: resampling pressure through
 * any other index set desyncs width from position, and the stroke tapers in the wrong places.
 */
export function simplifyWithIndices(points: readonly Point[], epsilon = 1): number[] {
  if (points.length <= 2) return points.map((_, i) => i);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    const a = points[start]!;
    const b = points[end]!;
    let maxDist = -1;
    let maxIdx = -1;

    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const d = perpendicularDistance(p[0], p[1], a[0], a[1], b[0], b[1]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(i);
  return out;
}

function perpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  // Distance to the INFINITE line here — RDP measures deviation from the chord, not the segment.
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(lenSq);
}

/**
 * Build a smoothed Path2D from points, using Catmull-Rom converted to cubic Bezier.
 *
 * Catmull-Rom passes exactly through every control point, which matters for a pen: the line must
 * go where the user drew, not near it. A plain quadratic-midpoint smooth cuts corners and makes
 * handwriting look wrong.
 */
export function strokePath(points: readonly Point[], originX = 0, originY = 0): Path2D {
  const path = new Path2D();
  const n = points.length;
  if (n === 0) return path;

  const px = (i: number) => originX + points[clampIdx(i, n)]![0];
  const py = (i: number) => originY + points[clampIdx(i, n)]![1];

  path.moveTo(px(0), py(0));

  if (n === 1) {
    // A single tap still needs to leave a mark.
    path.lineTo(px(0) + 0.01, py(0) + 0.01);
    return path;
  }
  if (n === 2) {
    path.lineTo(px(1), py(1));
    return path;
  }

  for (let i = 0; i < n - 1; i++) {
    const p0x = px(i - 1);
    const p0y = py(i - 1);
    const p1x = px(i);
    const p1y = py(i);
    const p2x = px(i + 1);
    const p2y = py(i + 1);
    const p3x = px(i + 2);
    const p3y = py(i + 2);

    // Catmull-Rom (tension 0.5) → cubic Bezier control points.
    path.bezierCurveTo(
      p1x + (p2x - p0x) / 6,
      p1y + (p2y - p0y) / 6,
      p2x - (p3x - p1x) / 6,
      p2y - (p3y - p1y) / 6,
      p2x,
      p2y,
    );
  }

  return path;
}

function clampIdx(i: number, n: number): number {
  return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
}

/**
 * Build a filled OUTLINE for a pressure-varying stroke.
 *
 * A constant-width stroke is a wire; a brush stroke tapers. Canvas 2D has no variable-width
 * stroking, so the only way to get it is to compute the outline ourselves and FILL it:
 * walk the spine offsetting left by the radius at each point, walk back offsetting right,
 * close the loop.
 *
 * Returns a path to `fill()`, never to `stroke()`.
 */
export function variableWidthPath(
  points: readonly Point[],
  pressures: readonly number[] | undefined,
  baseWidth: number,
  originX = 0,
  originY = 0,
  taper = 1,
): Path2D {
  const path = new Path2D();
  const n = points.length;
  if (n === 0) return path;

  const radiusAt = (i: number): number => {
    // No pressure data (mouse input) → constant width, which is the correct fallback.
    const raw = pressures?.[i];
    const p = raw === undefined || raw <= 0 ? 0.5 : raw;
    // Ease the response: raw pressure is twitchy and makes strokes look lumpy.
    const eased = 0.35 + 0.65 * Math.sqrt(p);

    // Taper the first and last few points to a point, the way a real brush lifts.
    let endScale = 1;
    if (taper > 0) {
      const fromStart = i;
      const fromEnd = n - 1 - i;
      const span = Math.min(6, Math.floor(n / 3));
      if (span > 0) {
        if (fromStart < span) endScale = Math.min(endScale, (fromStart + 1) / (span + 1));
        if (fromEnd < span) endScale = Math.min(endScale, (fromEnd + 1) / (span + 1));
      }
    }
    return Math.max(0.35, (baseWidth / 2) * eased * endScale);
  };

  if (n === 1) {
    const p = points[0]!;
    path.arc(originX + p[0], originY + p[1], radiusAt(0), 0, Math.PI * 2);
    return path;
  }

  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const curr = points[i]!;
    // Tangent from neighbours, so the normal is stable through curves rather than
    // snapping at every sample.
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(n - 1, i + 1)]!;

    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }

    // Perpendicular.
    const nx = -dy;
    const ny = dx;
    const r = radiusAt(i);
    const cx = originX + curr[0];
    const cy = originY + curr[1];

    left.push([cx + nx * r, cy + ny * r]);
    right.push([cx - nx * r, cy - ny * r]);
  }

  path.moveTo(left[0]![0], left[0]![1]);
  for (let i = 1; i < left.length; i++) path.lineTo(left[i]![0], left[i]![1]);
  // Walk the far side back to close the loop.
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i]![0], right[i]![1]);
  path.closePath();

  return path;
}

/**
 * Light low-pass over the pressure series.
 *
 * Raw pressure from a stylus is noisy enough that an unsmoothed stroke looks lumpy even when
 * the spine is perfectly smooth.
 */
export function smoothPressures(pressures: readonly number[], window = 3): number[] {
  const out: number[] = [];
  for (let i = 0; i < pressures.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(pressures.length - 1, i + window); j++) {
      sum += pressures[j] ?? 0.5;
      count++;
    }
    out.push(count === 0 ? 0.5 : sum / count);
  }
  return out;
}

/**
 * Rebase absolute points onto a shape origin.
 *
 * Points are stored RELATIVE to the shape origin so a move is a two-field update rather than an
 * N-point rewrite — see docs/02-ARCHITECTURE.md §4.
 */
export function normalizePoints(abs: readonly Point[]): { x: number; y: number; points: Point[] } {
  if (abs.length === 0) return { x: 0, y: 0, points: [] };
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of abs) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return { x: minX, y: minY, points: abs.map(([x, y]) => [x - minX, y - minY] as Point) };
}
