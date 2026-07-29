import type { Engine } from '@board/canvas-engine';
import { shapeBounds, type Rect } from '@board/canvas-engine';
import type { ShapeId } from '@board/shared';

export interface SnapGuide {
  axis: 'x' | 'y';
  /** World coordinate of the guide line. */
  pos: number;
  /** Extent to draw the guide across, so it visually connects the aligned shapes. */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** Snap distance in SCREEN pixels, converted to world units so it feels identical at any zoom. */
const SNAP_SCREEN_PX = 6;

/**
 * Align a moving rect to nearby shapes' edges and centres.
 *
 * Only considers shapes currently in the viewport: snapping to something 10,000 units off-screen
 * is never what the user meant, and it keeps this O(visible) instead of O(document).
 */
export function computeSnap(
  engine: Engine,
  moving: Rect,
  exclude: Set<ShapeId>,
): SnapResult {
  const threshold = SNAP_SCREEN_PX / engine.camera.zoom;

  const movingEdgesX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movingEdgesY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestX: { delta: number; pos: number; other: Rect } | null = null;
  let bestY: { delta: number; pos: number; other: Rect } | null = null;

  for (const shape of engine.visibleShapes()) {
    if (exclude.has(shape.id)) continue;
    const b = shapeBounds(shape);
    const targetsX = [b.x, b.x + b.w / 2, b.x + b.w];
    const targetsY = [b.y, b.y + b.h / 2, b.y + b.h];

    for (const me of movingEdgesX) {
      for (const t of targetsX) {
        const delta = t - me;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, pos: t, other: b };
        }
      }
    }
    for (const me of movingEdgesY) {
      for (const t of targetsY) {
        const delta = t - me;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, pos: t, other: b };
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (bestX) {
    guides.push({
      axis: 'x',
      pos: bestX.pos,
      from: Math.min(moving.y, bestX.other.y) - 20,
      to: Math.max(moving.y + moving.h, bestX.other.y + bestX.other.h) + 20,
    });
  }
  if (bestY) {
    guides.push({
      axis: 'y',
      pos: bestY.pos,
      from: Math.min(moving.x, bestY.other.x) - 20,
      to: Math.max(moving.x + moving.w, bestY.other.x + bestY.other.w) + 20,
    });
  }

  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}

export function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  guides: SnapGuide[],
  zoom: number,
): void {
  if (guides.length === 0) return;
  ctx.save();
  // Guides are the one piece of ephemeral UI allowed a hue — they are a transient signal, not
  // ambient chrome, and pink is the established convention for alignment guides.
  ctx.strokeStyle = '#E5457E';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  for (const g of guides) {
    if (g.axis === 'x') {
      ctx.moveTo(g.pos, g.from);
      ctx.lineTo(g.pos, g.to);
    } else {
      ctx.moveTo(g.from, g.pos);
      ctx.lineTo(g.to, g.pos);
    }
  }
  ctx.stroke();
  ctx.restore();
}
