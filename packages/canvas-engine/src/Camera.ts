import { MAX_ZOOM, MIN_ZOOM } from '@board/shared';
import type { Rect } from './geometry.js';

/**
 * Viewport transform.
 *
 * Convention: (x, y) is the WORLD coordinate that sits at the screen origin (top-left).
 *
 *   screen = (world - camera) * zoom
 *   world  = screen / zoom + camera
 *
 * Everything else in the engine depends on those two lines being right, so they are stated once
 * here and never re-derived inline.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  /** Device pixel ratio — kept here so renderers never guess at HiDPI scaling. */
  dpr = 1;

  screenToWorldX(sx: number): number {
    return sx / this.zoom + this.x;
  }

  screenToWorldY(sy: number): number {
    return sy / this.zoom + this.y;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.screenToWorldX(sx), y: this.screenToWorldY(sy) };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /**
   * Zoom toward a screen point, keeping the world point under the cursor fixed.
   *
   * Zooming toward the viewport centre instead is the single most common canvas mistake — it
   * makes precise navigation feel like fighting the app.
   */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;

    // World point currently under the cursor must stay under the cursor.
    const wx = this.screenToWorldX(sx);
    const wy = this.screenToWorldY(sy);
    this.zoom = next;
    this.x = wx - sx / next;
    this.y = wy - sy / next;
  }

  setZoom(zoom: number, viewportW: number, viewportH: number): void {
    this.zoomAt(viewportW / 2, viewportH / 2, clamp(zoom, MIN_ZOOM, MAX_ZOOM) / this.zoom);
  }

  /** The world-space rect currently visible, optionally padded. */
  worldViewport(viewportW: number, viewportH: number, padding = 0): Rect {
    const pad = padding / this.zoom;
    return {
      x: this.x - pad,
      y: this.y - pad,
      w: viewportW / this.zoom + pad * 2,
      h: viewportH / this.zoom + pad * 2,
    };
  }

  /** Fit a world rect into the viewport with margin. */
  fitTo(target: Rect, viewportW: number, viewportH: number, margin = 80): void {
    if (target.w <= 0 || target.h <= 0) return;
    const zoom = clamp(
      Math.min((viewportW - margin * 2) / target.w, (viewportH - margin * 2) / target.h),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.zoom = zoom;
    this.x = target.x + target.w / 2 - viewportW / 2 / zoom;
    this.y = target.y + target.h / 2 - viewportH / 2 / zoom;
  }

  centerOn(wx: number, wy: number, viewportW: number, viewportH: number): void {
    this.x = wx - viewportW / 2 / this.zoom;
    this.y = wy - viewportH / 2 / this.zoom;
  }

  /**
   * Apply as a single setTransform.
   *
   * Deliberately not a save/restore chain: setTransform is one matrix write, while nested
   * save/restore accumulates state-stack churn on every frame at 10k shapes.
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    const s = this.zoom * this.dpr;
    ctx.setTransform(s, 0, 0, s, -this.x * s, -this.y * s);
  }

  resetTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  serialize(): { x: number; y: number; zoom: number } {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  restore(state: { x: number; y: number; zoom: number } | null | undefined): void {
    if (!state) return;
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y) || !Number.isFinite(state.zoom)) {
      return;
    }
    this.x = state.x;
    this.y = state.y;
    this.zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
  }
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
