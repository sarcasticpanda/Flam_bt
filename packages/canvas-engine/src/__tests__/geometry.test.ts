import { describe, expect, it } from 'vitest';
import {
  distanceToSegment,
  edgeIntersection,
  pointInShape,
  rectContainsRect,
  rectIntersects,
  rotatedBounds,
  shapeBounds,
  unionRect,
} from '../geometry.js';
import type { DrawShape, EllipseShape, RectShape } from '@board/shared';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const baseFields = {
  rotation: 0,
  z: 'a0',
  parentId: null,
  locked: false,
  opacity: 1,
  createdBy: 'u',
  createdAt: 0,
  updatedAt: 0,
};

const rect = (over: Partial<RectShape> = {}): RectShape => ({
  ...baseFields,
  id: 'r',
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  stroke: '#000',
  fill: 'transparent',
  strokeWidth: 2,
  dash: 'solid',
  radius: 0,
  text: '',
  textAlign: 'center',
  fontSize: 16,
  ...over,
});

describe('rect algebra', () => {
  it('counts touching edges as intersecting', () => {
    // A shape sitting exactly on the viewport edge must still be drawn.
    expect(rectIntersects(R(0, 0, 10, 10), R(10, 0, 10, 10))).toBe(true);
  });

  it('rejects separated rects', () => {
    expect(rectIntersects(R(0, 0, 10, 10), R(11, 0, 10, 10))).toBe(false);
  });

  it('distinguishes containment from intersection for marquee select', () => {
    expect(rectContainsRect(R(0, 0, 100, 100), R(10, 10, 10, 10))).toBe(true);
    // Partially overlapping is NOT contained — marquee should not grab it.
    expect(rectContainsRect(R(0, 0, 100, 100), R(90, 90, 50, 50))).toBe(false);
  });

  it('unions rects', () => {
    expect(unionRect(R(0, 0, 10, 10), R(20, 20, 10, 10))).toEqual(R(0, 0, 30, 30));
  });
});

describe('rotation', () => {
  it('grows the AABB of a rect rotated 45 degrees', () => {
    const b = rotatedBounds(R(0, 0, 100, 100), Math.PI / 4);
    expect(b.w).toBeCloseTo(Math.SQRT2 * 100, 4);
    expect(b.h).toBeCloseTo(Math.SQRT2 * 100, 4);
    // Stays centred on the original centre.
    expect(b.x + b.w / 2).toBeCloseTo(50, 6);
  });

  it('leaves a square unchanged at 90 degrees', () => {
    const b = rotatedBounds(R(0, 0, 100, 100), Math.PI / 2);
    expect(b.w).toBeCloseTo(100, 6);
    expect(b.h).toBeCloseTo(100, 6);
  });

  it('swaps w/h for a non-square rotated 90 degrees', () => {
    const b = rotatedBounds(R(0, 0, 200, 100), Math.PI / 2);
    expect(b.w).toBeCloseTo(100, 6);
    expect(b.h).toBeCloseTo(200, 6);
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular distance within the segment', () => {
    expect(distanceToSegment(5, 10, 0, 0, 10, 0)).toBeCloseTo(10, 6);
  });

  it('clamps past the ends — a segment, not an infinite line', () => {
    // The infinite line through (0,0)-(10,0) is 0 away from (20,0); the SEGMENT is 10 away.
    expect(distanceToSegment(20, 0, 0, 0, 10, 0)).toBeCloseTo(10, 6);
  });

  it('handles a degenerate zero-length segment', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
  });
});

describe('pointInShape', () => {
  it('hits inside a rect and misses outside', () => {
    expect(pointInShape(rect(), 50, 50)).toBe(true);
    expect(pointInShape(rect(), 150, 50)).toBe(false);
  });

  it('respects ellipse curvature rather than its bounding box', () => {
    const e = { ...rect(), type: 'ellipse' } as unknown as EllipseShape;
    expect(pointInShape(e, 50, 50)).toBe(true);
    // Corner of the bounding box is outside the ellipse itself.
    expect(pointInShape(e, 2, 2)).toBe(false);
  });

  it('accounts for rotation by probing in the unrotated frame', () => {
    const r = rect({ w: 200, h: 40, rotation: Math.PI / 2 });
    // After a 90° turn about its centre, the long axis runs vertically.
    expect(pointInShape(r, 100, 20)).toBe(true);
    expect(pointInShape(r, 100, 110)).toBe(true);
    expect(pointInShape(r, 190, 20)).toBe(false);
  });

  it('hit-tests a pen stroke by proximity, scaled by stroke width', () => {
    const d: DrawShape = {
      ...baseFields,
      id: 'd',
      type: 'draw',
      x: 0,
      y: 0,
      w: 100,
      h: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
      stroke: '#000',
      strokeWidth: 4,
      blend: 'normal',
    };
    expect(pointInShape(d, 50, 1, 4)).toBe(true);
    expect(pointInShape(d, 50, 40, 4)).toBe(false);
  });
});

describe('shapeBounds', () => {
  it('derives path bounds from points, padded by stroke width', () => {
    const d: DrawShape = {
      ...baseFields,
      id: 'd',
      type: 'draw',
      x: 10,
      y: 10,
      // Deliberately stale w/h — bounds must come from the points, not from these.
      w: 0,
      h: 0,
      points: [
        [0, 0],
        [50, 30],
      ],
      stroke: '#000',
      strokeWidth: 10,
      blend: 'normal',
    };
    const b = shapeBounds(d);
    expect(b.x).toBeCloseTo(10 - 6, 6); // strokeWidth/2 + 1
    expect(b.w).toBeCloseTo(50 + 12, 6);
  });

  it('returns plain bounds for an unrotated box', () => {
    expect(shapeBounds(rect({ x: 5, y: 6, w: 20, h: 30 }))).toEqual(R(5, 6, 20, 30));
  });
});

describe('edgeIntersection', () => {
  it('meets the right edge when approached from the right', () => {
    const p = edgeIntersection(R(0, 0, 100, 100), 500, 50);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });

  it('meets the top edge when approached from above', () => {
    const p = edgeIntersection(R(0, 0, 100, 100), 50, -500);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(50, 6);
  });

  it('degrades to the centre when the source is the centre', () => {
    const p = edgeIntersection(R(0, 0, 100, 100), 50, 50);
    expect(p).toEqual({ x: 50, y: 50 });
  });
});
