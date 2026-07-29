import { describe, expect, it } from 'vitest';
import { Camera } from '../Camera.js';
import { MAX_ZOOM, MIN_ZOOM } from '@board/shared';

describe('Camera', () => {
  it('round-trips screen <-> world at zoom 1', () => {
    const c = new Camera();
    c.x = 100;
    c.y = 50;
    const w = c.screenToWorld(10, 20);
    expect(w).toEqual({ x: 110, y: 70 });
    expect(c.worldToScreen(110, 70)).toEqual({ x: 10, y: 20 });
  });

  it('round-trips at a non-unit zoom', () => {
    const c = new Camera();
    c.x = -300;
    c.y = 220;
    c.zoom = 2.5;
    const s = c.worldToScreen(42, -17);
    const w = c.screenToWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(42, 9);
    expect(w.y).toBeCloseTo(-17, 9);
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    // This is THE camera test. Zooming toward the viewport centre instead of the cursor is the
    // most common canvas bug and makes precise navigation feel like fighting the app.
    const c = new Camera();
    c.x = 137;
    c.y = -64;
    c.zoom = 1.3;

    const sx = 421;
    const sy = 268;
    const before = c.screenToWorld(sx, sy);

    c.zoomAt(sx, sy, 1.6);
    const after = c.screenToWorld(sx, sy);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(c.zoom).toBeCloseTo(1.3 * 1.6, 9);
  });

  it('holds the anchor across many successive zooms', () => {
    // Drift only shows up after repeated wheel events, which is exactly how users zoom.
    const c = new Camera();
    const sx = 300;
    const sy = 200;
    const target = c.screenToWorld(sx, sy);

    for (let i = 0; i < 40; i++) c.zoomAt(sx, sy, i % 2 === 0 ? 1.1 : 0.95);

    const after = c.screenToWorld(sx, sy);
    expect(after.x).toBeCloseTo(target.x, 4);
    expect(after.y).toBeCloseTo(target.y, 4);
  });

  it('clamps zoom to the configured range', () => {
    const c = new Camera();
    for (let i = 0; i < 100; i++) c.zoomAt(0, 0, 2);
    expect(c.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 200; i++) c.zoomAt(0, 0, 0.5);
    expect(c.zoom).toBe(MIN_ZOOM);
  });

  it('does not move the camera when zoom is already clamped', () => {
    const c = new Camera();
    c.zoom = MAX_ZOOM;
    const { x, y } = c;
    c.zoomAt(400, 300, 2);
    expect(c.x).toBe(x);
    expect(c.y).toBe(y);
  });

  it('pans in world units scaled by zoom', () => {
    const c = new Camera();
    c.zoom = 2;
    c.pan(100, 50);
    // Dragging 100 screen px at 2x moves the camera 50 world units.
    expect(c.x).toBeCloseTo(-50, 9);
    expect(c.y).toBeCloseTo(-25, 9);
  });

  it('reports a world viewport that grows as zoom decreases', () => {
    const c = new Camera();
    c.zoom = 0.5;
    const vp = c.worldViewport(800, 600);
    expect(vp.w).toBeCloseTo(1600, 6);
    expect(vp.h).toBeCloseTo(1200, 6);
  });

  it('pads the world viewport in world units, not screen units', () => {
    const c = new Camera();
    c.zoom = 2;
    const vp = c.worldViewport(800, 600, 200);
    // 200 screen px at 2x zoom is 100 world units on each side.
    expect(vp.x).toBeCloseTo(-100, 6);
    expect(vp.w).toBeCloseTo(400 + 200, 6);
  });

  it('centres a rect via fitTo', () => {
    const c = new Camera();
    c.fitTo({ x: 1000, y: 1000, w: 400, h: 400 }, 800, 600, 0);
    const centre = c.screenToWorld(400, 300);
    expect(centre.x).toBeCloseTo(1200, 4);
    expect(centre.y).toBeCloseTo(1200, 4);
  });

  it('ignores a degenerate fitTo target instead of producing NaN', () => {
    const c = new Camera();
    c.fitTo({ x: 0, y: 0, w: 0, h: 0 }, 800, 600);
    expect(Number.isFinite(c.zoom)).toBe(true);
    expect(c.zoom).toBe(1);
  });

  it('rejects a corrupt restored viewport', () => {
    // Viewport comes from localStorage, which is untrusted input.
    const c = new Camera();
    c.restore({ x: NaN, y: 0, zoom: 1 });
    expect(c.x).toBe(0);
    c.restore(null);
    expect(c.zoom).toBe(1);
    c.restore({ x: 5, y: 6, zoom: 999 });
    expect(c.zoom).toBe(MAX_ZOOM);
  });
});
