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
  if (points.length <= 2) return [...points];

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

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
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
