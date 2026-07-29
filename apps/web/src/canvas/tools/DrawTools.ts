import type { Camera } from '@board/canvas-engine';
import { edgeIntersection, normalizePoints, shapeBounds, simplify, strokePath } from '@board/canvas-engine';
import { STICKY_SIZE, newShapeId, type Point, type Shape, type ShapeId } from '@board/shared';
import type { CanvasPointerEvent, Tool, ToolContext, ToolId } from './types';

function baseFields(ctx: ToolContext, z: string) {
  const now = Date.now();
  return {
    id: newShapeId(),
    rotation: 0,
    z,
    parentId: null,
    locked: false,
    opacity: ctx.style.opacity,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Rect / ellipse
// ---------------------------------------------------------------------------

export class BoxTool implements Tool {
  readonly cursor = 'crosshair';
  private start: { x: number; y: number } | null = null;
  private current: { x: number; y: number } | null = null;

  constructor(readonly id: 'rect' | 'ellipse') {}

  onPointerDown(e: CanvasPointerEvent): void {
    if (e.button !== 0) return;
    this.start = { ...e.world };
    this.current = { ...e.world };
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.start) return;
    this.current = { ...e.world };
    ctx.engine.markActiveDirty();
  }

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.start) return;
    const rect = this.resolve(e);
    this.start = null;
    this.current = null;

    // A click without a drag is almost always a misfire, not an intent to make a 1px shape.
    if (rect.w < 3 || rect.h < 3) {
      ctx.engine.markActiveDirty();
      return;
    }

    const shape = {
      ...baseFields(ctx, ctx.doc.nextZ(1)[0]!),
      type: this.id,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      stroke: ctx.style.stroke,
      fill: ctx.style.fill,
      strokeWidth: ctx.style.strokeWidth,
      dash: ctx.style.dash,
      radius: 4,
      text: '',
      textAlign: ctx.style.textAlign,
      fontSize: ctx.style.fontSize,
    } as Shape;

    ctx.doc.add(shape);
    ctx.setSelection([shape.id]);
    // Snap back to select: drawing one shape then immediately manipulating it is the common flow.
    ctx.setTool('select');
  }

  onCancel(ctx: ToolContext): void {
    this.start = null;
    this.current = null;
    ctx.engine.markActiveDirty();
  }

  private resolve(e: CanvasPointerEvent) {
    const a = this.start!;
    const b = this.current ?? e.world;
    let x = Math.min(a.x, b.x);
    let y = Math.min(a.y, b.y);
    let w = Math.abs(b.x - a.x);
    let h = Math.abs(b.y - a.y);

    if (e.shiftKey) {
      const size = Math.max(w, h);
      if (b.x < a.x) x = a.x - size;
      if (b.y < a.y) y = a.y - size;
      w = size;
      h = size;
    }
    // alt draws from the centre outward.
    if (e.altKey) {
      x = a.x - w;
      y = a.y - h;
      w *= 2;
      h *= 2;
    }
    return { x, y, w, h };
  }

  drawPreview(rc: CanvasRenderingContext2D, camera: Camera, ctx: ToolContext): void {
    if (!this.start || !this.current) return;
    const r = this.resolve({
      world: this.current,
      shiftKey: false,
      altKey: false,
    } as CanvasPointerEvent);
    rc.strokeStyle = ctx.engine.getTheme().canvasInk;
    rc.lineWidth = ctx.style.strokeWidth / camera.zoom;
    rc.setLineDash([]);
    if (this.id === 'ellipse') {
      rc.beginPath();
      rc.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      rc.stroke();
    } else {
      rc.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
}

// ---------------------------------------------------------------------------
// Line / arrow
// ---------------------------------------------------------------------------

export class LineTool implements Tool {
  readonly cursor = 'crosshair';
  private start: { x: number; y: number } | null = null;
  private current: { x: number; y: number } | null = null;
  private bindStartId: ShapeId | null = null;

  constructor(readonly id: 'line' | 'arrow') {}

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.start = { ...e.world };
    this.current = { ...e.world };
    // Binding: dropping an endpoint on a shape makes the arrow follow it.
    const hit = ctx.engine.hitTest(e.world.x, e.world.y);
    this.bindStartId = this.id === 'arrow' && hit ? hit.id : null;
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.start) return;
    this.current = this.constrain(e);
    ctx.engine.markActiveDirty();
  }

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.start) return;
    const end = this.constrain(e);
    const start = this.start;
    this.start = null;
    this.current = null;

    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) {
      ctx.engine.markActiveDirty();
      return;
    }

    const endHit = this.id === 'arrow' ? ctx.engine.hitTest(end.x, end.y) : null;
    const bindEndId = endHit && endHit.id !== this.bindStartId ? endHit.id : null;

    const abs: Point[] = [
      [start.x, start.y],
      [end.x, end.y],
    ];
    const norm = normalizePoints(abs);
    const bounds = { w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };

    const shape = {
      ...baseFields(ctx, ctx.doc.nextZ(1)[0]!),
      type: this.id,
      x: norm.x,
      y: norm.y,
      w: bounds.w,
      h: bounds.h,
      points: norm.points,
      stroke: ctx.style.stroke,
      strokeWidth: ctx.style.strokeWidth,
      dash: ctx.style.dash,
      arrowheads: this.id === 'arrow' ? [false, true] : [false, false],
      label: '',
      bindStart: this.bindStartId,
      bindEnd: bindEndId,
    } as Shape;

    ctx.doc.add(shape);
    ctx.setSelection([shape.id]);
    ctx.setTool('select');
    this.bindStartId = null;
  }

  onCancel(ctx: ToolContext): void {
    this.start = null;
    this.current = null;
    this.bindStartId = null;
    ctx.engine.markActiveDirty();
  }

  /** Shift constrains to 45° increments. */
  private constrain(e: CanvasPointerEvent): { x: number; y: number } {
    if (!e.shiftKey || !this.start) return { ...e.world };
    const dx = e.world.x - this.start.x;
    const dy = e.world.y - this.start.y;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: this.start.x + Math.cos(angle) * len, y: this.start.y + Math.sin(angle) * len };
  }

  drawPreview(rc: CanvasRenderingContext2D, camera: Camera, ctx: ToolContext): void {
    if (!this.start || !this.current) return;
    rc.strokeStyle = ctx.engine.getTheme().canvasInk;
    rc.lineWidth = ctx.style.strokeWidth / camera.zoom;
    rc.setLineDash([]);
    rc.lineCap = 'round';
    rc.beginPath();
    rc.moveTo(this.start.x, this.start.y);
    rc.lineTo(this.current.x, this.current.y);
    rc.stroke();
  }
}

// ---------------------------------------------------------------------------
// Pen / highlighter
// ---------------------------------------------------------------------------

export class PenTool implements Tool {
  readonly cursor = 'crosshair';
  private points: Point[] = [];
  private drawing = false;

  constructor(readonly id: 'pen' | 'highlighter') {}

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.drawing = true;
    this.points = [[e.world.x, e.world.y]];
    ctx.engine.setInteracting(true);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.drawing) return;

    // getCoalescedEvents captures the FULL high-frequency input path. Without it a fast stroke
    // is sampled at display rate and comes out visibly polygonal — the clearest tell that a
    // drawing tool is a toy.
    const coalesced = e.native.getCoalescedEvents?.() ?? [];
    if (coalesced.length > 1) {
      const rect = (e.native.target as HTMLElement).getBoundingClientRect();
      for (const ce of coalesced) {
        const w = ctx.engine.camera.screenToWorld(ce.clientX - rect.left, ce.clientY - rect.top);
        this.points.push([w.x, w.y]);
      }
    } else {
      this.points.push([e.world.x, e.world.y]);
    }
    ctx.engine.markActiveDirty();
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    ctx.engine.setInteracting(false);

    if (this.points.length < 2) {
      this.points = [];
      ctx.engine.markActiveDirty();
      return;
    }

    // Simplify on pointerup, not during the stroke: RDP needs the whole path, and simplifying
    // live would make the line visibly re-shape under the cursor.
    const epsilon = 0.6 / ctx.engine.camera.zoom;
    const simplified = simplify(this.points, epsilon);
    const norm = normalizePoints(simplified);
    const b = bounds(norm.points);

    const shape = {
      ...baseFields(ctx, ctx.doc.nextZ(1)[0]!),
      type: 'draw',
      x: norm.x,
      y: norm.y,
      w: b.w,
      h: b.h,
      points: norm.points,
      stroke: ctx.style.stroke,
      strokeWidth: this.id === 'highlighter' ? Math.max(ctx.style.strokeWidth * 4, 16) : ctx.style.strokeWidth,
      blend: this.id === 'highlighter' ? 'multiply' : 'normal',
      opacity: this.id === 'highlighter' ? 0.4 : ctx.style.opacity,
    } as Shape;

    ctx.doc.add(shape);
    this.points = [];
    ctx.engine.markActiveDirty();
    // Stay on the pen: people draw several strokes in a row.
  }

  onCancel(ctx: ToolContext): void {
    this.drawing = false;
    this.points = [];
    ctx.engine.setInteracting(false);
    ctx.engine.markActiveDirty();
  }

  drawPreview(rc: CanvasRenderingContext2D, camera: Camera, ctx: ToolContext): void {
    if (this.points.length < 2) return;
    rc.strokeStyle = ctx.engine.getTheme().canvasInk;
    rc.lineWidth =
      (this.id === 'highlighter' ? Math.max(ctx.style.strokeWidth * 4, 16) : ctx.style.strokeWidth);
    rc.lineCap = 'round';
    rc.lineJoin = 'round';
    rc.setLineDash([]);
    if (this.id === 'highlighter') rc.globalAlpha = 0.4;
    // Preview uses the same smoothing as the committed shape, so the stroke does not visibly
    // change shape the instant you lift the pointer.
    rc.stroke(strokePath(this.points));
    rc.globalAlpha = 1;
    void camera;
  }
}

// ---------------------------------------------------------------------------
// Sticky
// ---------------------------------------------------------------------------

export class StickyTool implements Tool {
  readonly id = 'sticky' as const;
  readonly cursor = 'crosshair';

  onPointerDown(): void {}
  onPointerMove(): void {}

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const shape = {
      ...baseFields(ctx, ctx.doc.nextZ(1)[0]!),
      type: 'sticky',
      // Drop centred on the cursor — placing by top-left corner always feels offset.
      x: e.world.x - STICKY_SIZE / 2,
      y: e.world.y - STICKY_SIZE / 2,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      text: '',
      color: ctx.style.stickyColor,
      fontSize: 16,
      tags: [],
      opacity: 1,
    } as Shape;

    ctx.doc.add(shape);
    ctx.setSelection([shape.id]);
    ctx.setTool('select');
    // An empty sticky is useless — go straight into editing it.
    ctx.editText(shape);
  }

  onCancel(): void {}
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export class TextTool implements Tool {
  readonly id = 'text' as const;
  readonly cursor = 'text';

  onPointerDown(): void {}
  onPointerMove(): void {}

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const shape = {
      ...baseFields(ctx, ctx.doc.nextZ(1)[0]!),
      type: 'text',
      x: e.world.x,
      y: e.world.y - ctx.style.fontSize / 2,
      w: 200,
      h: ctx.style.fontSize * 1.4,
      text: '',
      fontSize: ctx.style.fontSize,
      fontFamily: '"Geist Sans", system-ui, sans-serif',
      color: ctx.style.stroke,
      align: ctx.style.textAlign,
      autoWidth: true,
    } as Shape;

    ctx.doc.add(shape);
    ctx.setSelection([shape.id]);
    ctx.setTool('select');
    ctx.editText(shape);
  }

  onCancel(): void {}
}

// ---------------------------------------------------------------------------
// Eraser
// ---------------------------------------------------------------------------

export class EraserTool implements Tool {
  readonly id = 'eraser' as const;
  readonly cursor = 'crosshair';
  private erasing = false;
  private pending = new Set<ShapeId>();

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.erasing = true;
    this.pending.clear();
    this.eraseAt(e, ctx);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.erasing) return;
    this.eraseAt(e, ctx);
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.erasing) return;
    this.erasing = false;
    if (this.pending.size > 0) {
      // One transaction for the whole erase stroke, so a single ctrl+Z brings everything back.
      ctx.doc.delete([...this.pending]);
      this.pending.clear();
    }
    ctx.engine.markActiveDirty();
  }

  onCancel(ctx: ToolContext): void {
    this.erasing = false;
    // Restore anything hidden but not yet committed to a delete.
    for (const id of this.pending) {
      const s = ctx.doc.get(id);
      if (s) ctx.engine.putShape(s);
    }
    this.pending.clear();
    ctx.engine.markActiveDirty();
  }

  private eraseAt(e: CanvasPointerEvent, ctx: ToolContext): void {
    const hit = ctx.engine.hitTest(e.world.x, e.world.y);
    if (!hit || this.pending.has(hit.id)) return;
    this.pending.add(hit.id);
    // Hide immediately for feedback; the document write happens once on pointerup.
    ctx.engine.removeShape(hit.id);
    ctx.engine.markDirty();
  }
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

export class HandTool implements Tool {
  readonly id = 'hand' as const;
  readonly cursor = 'grab';
  private panning = false;
  private last = { x: 0, y: 0 };

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.panning = true;
    this.last = { ...e.screen };
    ctx.engine.setInteracting(true);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.panning) return;
    ctx.engine.camera.pan(e.screen.x - this.last.x, e.screen.y - this.last.y);
    this.last = { ...e.screen };
    ctx.engine.markDirty();
    ctx.engine.markOverlayDirty();
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    this.panning = false;
    ctx.engine.setInteracting(false);
  }

  onCancel(ctx: ToolContext): void {
    this.panning = false;
    ctx.engine.setInteracting(false);
  }
}

// ---------------------------------------------------------------------------

function bounds(points: readonly Point[]): { w: number; h: number } {
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of points) {
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { w: maxX, h: maxY };
}

/**
 * Re-route arrows whose endpoints are bound to shapes.
 *
 * Called after any move so a bound arrow tracks its target. Runs over arrows only, and only
 * those with a binding, so it costs nothing on a board without them.
 */
export function reflowBoundArrows(ctx: ToolContext, movedIds: Set<ShapeId>): void {
  const patches: Array<{ id: ShapeId; patch: Partial<Shape> }> = [];

  for (const shape of ctx.engine.allShapes()) {
    if (shape.type !== 'arrow') continue;
    if (!shape.bindStart && !shape.bindEnd) continue;
    if (
      !(shape.bindStart && movedIds.has(shape.bindStart)) &&
      !(shape.bindEnd && movedIds.has(shape.bindEnd))
    ) {
      continue;
    }

    const first = shape.points[0];
    const last = shape.points[shape.points.length - 1];
    if (!first || !last) continue;

    let ax = shape.x + first[0];
    let ay = shape.y + first[1];
    let bx = shape.x + last[0];
    let by = shape.y + last[1];

    if (shape.bindStart) {
      const target = ctx.engine.getShape(shape.bindStart);
      if (target) {
        const p = edgeIntersection(shapeBounds(target), bx, by);
        ax = p.x;
        ay = p.y;
      }
    }
    if (shape.bindEnd) {
      const target = ctx.engine.getShape(shape.bindEnd);
      if (target) {
        const p = edgeIntersection(shapeBounds(target), ax, ay);
        bx = p.x;
        by = p.y;
      }
    }

    const norm = normalizePoints([
      [ax, ay],
      [bx, by],
    ]);
    patches.push({
      id: shape.id,
      patch: {
        x: norm.x,
        y: norm.y,
        w: Math.abs(bx - ax),
        h: Math.abs(by - ay),
        points: norm.points,
      } as Partial<Shape>,
    });
  }

  if (patches.length > 0) ctx.doc.updateMany(patches);
}

export const TOOL_IDS: ToolId[] = [
  'select', 'hand', 'pen', 'highlighter', 'eraser',
  'rect', 'ellipse', 'line', 'arrow', 'text', 'sticky',
];
