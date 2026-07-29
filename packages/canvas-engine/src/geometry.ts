import type { Point, Shape } from '@board/shared';
import { isPathLike } from '@board/shared';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Vec {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Rect algebra
// ---------------------------------------------------------------------------

/** Touching edges count as intersecting — a shape exactly at the viewport edge must be drawn. */
export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** True when `inner` is fully inside `outer`. Used by marquee select. */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function rectCenter(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export function rotatePoint(px: number, py: number, cx: number, cy: number, rad: number): Vec {
  if (rad === 0) return { x: px, y: py };
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Axis-aligned bounds of a rotated box — the AABB of its four rotated corners. */
export function rotatedBounds(r: Rect, rotation: number): Rect {
  if (rotation === 0) return { ...r };
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const corners: Array<[number, number]> = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of corners) {
    const p = rotatePoint(px, py, cx, cy, rotation);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export function pointsBounds(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Perpendicular distance from a point to a finite segment (not the infinite line). */
export function distanceToSegment(
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
  // Clamp the projection so we measure to the segment, not past its ends.
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPolyline(
  px: number,
  py: number,
  points: readonly Point[],
  originX = 0,
  originY = 0,
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) {
    const p = points[0]!;
    return Math.hypot(px - (originX + p[0]), py - (originY + p[1]));
  }
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = distanceToSegment(
      px,
      py,
      originX + a[0],
      originY + a[1],
      originX + b[0],
      originY + b[1],
    );
    if (d < min) min = d;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Shape bounds
// ---------------------------------------------------------------------------

/**
 * World-space axis-aligned bounds. This is what goes into the spatial index.
 *
 * Path shapes derive their extent from their points rather than trusting w/h, because a stroke
 * being edited can outgrow stale w/h between updates — and a shape whose index bounds are too
 * small vanishes at the viewport edge, which is a maddening bug to chase.
 */
export function shapeBounds(shape: Shape): Rect {
  if (isPathLike(shape)) {
    const local = pointsBounds(shape.points);
    const rect: Rect = {
      x: shape.x + local.x,
      y: shape.y + local.y,
      w: local.w,
      h: local.h,
    };
    // Stroke width spills outside the geometric path.
    const pad = shape.strokeWidth / 2 + 1;
    return shape.rotation === 0
      ? expandRect(rect, pad)
      : expandRect(rotatedBounds(rect, shape.rotation), pad);
  }

  const rect: Rect = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  return shape.rotation === 0 ? rect : rotatedBounds(rect, shape.rotation);
}

export function shapesBounds(shapes: readonly Shape[]): Rect | null {
  let acc: Rect | null = null;
  for (const s of shapes) acc = unionRect(acc, shapeBounds(s));
  return acc;
}

// ---------------------------------------------------------------------------
// Precise hit testing
// ---------------------------------------------------------------------------

/**
 * Precise per-type hit test in world space.
 *
 * `tolerance` should be scaled by 1/zoom by the caller so a 2px line stays clickable when zoomed
 * out — otherwise thin strokes become impossible to select exactly when you most need to.
 */
export function pointInShape(shape: Shape, px: number, py: number, tolerance = 4): boolean {
  // Work in the shape's unrotated frame: rotate the probe backwards instead of rotating geometry.
  let qx = px;
  let qy = py;
  if (shape.rotation !== 0) {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const p = rotatePoint(px, py, cx, cy, -shape.rotation);
    qx = p.x;
    qy = p.y;
  }

  switch (shape.type) {
    case 'ellipse': {
      const rx = shape.w / 2;
      const ry = shape.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (qx - (shape.x + rx)) / rx;
      const ny = (qy - (shape.y + ry)) / ry;
      return nx * nx + ny * ny <= 1;
    }

    case 'line':
    case 'arrow':
    case 'draw':
      return (
        distanceToPolyline(qx, qy, shape.points, shape.x, shape.y) <=
        tolerance + shape.strokeWidth / 2
      );

    case 'frame': {
      // Frames are hit on their border and title bar only, so clicking inside a frame selects
      // the shape under the cursor rather than the frame itself.
      const inner = expandRect({ x: shape.x, y: shape.y, w: shape.w, h: shape.h }, -tolerance * 2);
      const outer = expandRect({ x: shape.x, y: shape.y, w: shape.w, h: shape.h }, tolerance);
      const onTitle = qy >= shape.y - 28 && qy <= shape.y && qx >= shape.x && qx <= shape.x + shape.w;
      return onTitle || (pointInRect(qx, qy, outer) && !pointInRect(qx, qy, inner));
    }

    default:
      return pointInRect(qx, qy, { x: shape.x, y: shape.y, w: shape.w, h: shape.h });
  }
}

// ---------------------------------------------------------------------------
// Arrow binding
// ---------------------------------------------------------------------------

/**
 * Where an arrow aimed at `from` should meet the border of `target`.
 *
 * Ray-to-box intersection from the target's centre. Keeps a bound arrow touching the edge of a
 * shape rather than burying its head in the middle of it.
 */
export function edgeIntersection(target: Rect, fromX: number, fromY: number): Vec {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = target.w / 2;
  const halfH = target.h / 2;
  // Scale the direction vector until it lands on whichever edge it reaches first.
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
