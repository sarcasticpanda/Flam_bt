import { describe, expect, it } from 'vitest';
import { normalizePoints, simplify } from '../smoothing.js';
import type { Point } from '@board/shared';

describe('simplify (Ramer-Douglas-Peucker)', () => {
  it('always keeps the first and last point', () => {
    const pts: Point[] = [
      [0, 0],
      [5, 0.2],
      [10, 0],
    ];
    const out = simplify(pts, 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
  });

  it('drops points that carry no shape information', () => {
    const pts: Point[] = [
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
      [8, 0],
      [10, 0],
    ];
    expect(simplify(pts, 1)).toHaveLength(2);
  });

  it('keeps a genuine corner', () => {
    const pts: Point[] = [
      [0, 0],
      [50, 0],
      [50, 50],
    ];
    const out = simplify(pts, 1);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual([50, 0]);
  });

  it('respects epsilon', () => {
    const pts: Point[] = [
      [0, 0],
      [5, 3],
      [10, 0],
    ];
    expect(simplify(pts, 1)).toHaveLength(3); // 3 > 1, kept
    expect(simplify(pts, 10)).toHaveLength(2); // 3 < 10, dropped
  });

  it('passes through inputs of length 0, 1 and 2 unchanged', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([[1, 1]], 1)).toEqual([[1, 1]]);
    expect(
      simplify(
        [
          [0, 0],
          [1, 1],
        ],
        1,
      ),
    ).toHaveLength(2);
  });

  it('handles a 5000-point stroke without blowing the stack', () => {
    // The naive recursive RDP overflows here. Someone scribbling fast in a demo produces
    // exactly this, and it would only ever fail in front of an audience.
    const pts: Point[] = Array.from({ length: 5000 }, (_, i) => [i, Math.sin(i / 25) * 40]);
    const out = simplify(pts, 1);
    expect(out.length).toBeGreaterThan(2);
    expect(out.length).toBeLessThan(pts.length);
    expect(out[0]).toEqual(pts[0]);
  });

  it('meaningfully reduces a realistic hand-drawn stroke', () => {
    // Smooth curve sampled densely, plus sub-pixel jitter, as a real pointer stream looks.
    const pts: Point[] = Array.from({ length: 800 }, (_, i) => {
      const t = i / 800;
      return [t * 500 + Math.sin(i) * 0.3, Math.sin(t * Math.PI * 2) * 100 + Math.cos(i) * 0.3];
    });
    const out = simplify(pts, 1.5);
    expect(out.length).toBeLessThan(pts.length / 10);
  });
});

describe('normalizePoints', () => {
  it('rebases absolute points onto the shape origin', () => {
    const { x, y, points } = normalizePoints([
      [100, 200],
      [150, 260],
      [120, 210],
    ]);
    expect(x).toBe(100);
    expect(y).toBe(200);
    expect(points[0]).toEqual([0, 0]);
    expect(points[1]).toEqual([50, 60]);
  });

  it('handles negative coordinates', () => {
    const { x, y, points } = normalizePoints([
      [-50, -80],
      [0, 0],
    ]);
    expect(x).toBe(-50);
    expect(y).toBe(-80);
    expect(points[1]).toEqual([50, 80]);
  });

  it('returns a zero origin for an empty stroke', () => {
    expect(normalizePoints([])).toEqual({ x: 0, y: 0, points: [] });
  });
});
