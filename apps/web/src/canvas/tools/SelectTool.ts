import type { Camera } from '@board/canvas-engine';
import { rotatePoint, shapeBounds, shapesBounds, type Rect } from '@board/canvas-engine';
import { DRAG_WRITE_THROTTLE_MS, isPathLike, type Shape, type ShapeId } from '@board/shared';
import type { CanvasPointerEvent, Tool, ToolContext } from './types';
import { computeSnap, drawSnapGuides, type SnapGuide } from './snapping';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
type Mode = 'idle' | 'marquee' | 'move' | 'resize' | 'rotate';

const HANDLE_SCREEN_PX = 9;
const ROTATE_OFFSET_PX = 26;

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  cursor = 'default';

  private mode: Mode = 'idle';
  private startWorld = { x: 0, y: 0 };
  private marquee: Rect | null = null;
  private handle: Handle | null = null;
  private guides: SnapGuide[] = [];

  /** Snapshot of shapes at drag start — every transform is computed from this, never cumulatively. */
  private originals = new Map<ShapeId, Shape>();
  private originalBounds: Rect | null = null;
  private lastWriteAt = 0;
  private hoverId: ShapeId | null = null;

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.startWorld = { ...e.world };
    this.guides = [];

    const selection = ctx.getSelection();

    // Handles take priority over shapes underneath them.
    if (selection.length > 0) {
      const handle = this.hitHandle(e.world, ctx);
      if (handle) {
        this.handle = handle;
        this.mode = handle === 'rotate' ? 'rotate' : 'resize';
        this.snapshot(ctx, selection);
        ctx.engine.setInteracting(true);
        return;
      }
    }

    const hit = ctx.engine.hitTest(e.world.x, e.world.y);

    if (!hit) {
      if (!e.shiftKey) ctx.setSelection([]);
      this.mode = 'marquee';
      this.marquee = { x: e.world.x, y: e.world.y, w: 0, h: 0 };
      ctx.engine.setInteracting(true);
      return;
    }

    if (e.shiftKey) {
      const next = selection.includes(hit.id)
        ? selection.filter((id) => id !== hit.id)
        : [...selection, hit.id];
      ctx.setSelection(next);
      // Toggling membership should not also start a drag — the click was about selection.
      this.mode = 'idle';
      return;
    }

    if (!selection.includes(hit.id)) ctx.setSelection([hit.id]);

    this.mode = 'move';
    this.snapshot(ctx, ctx.getSelection());
    ctx.engine.setInteracting(true);
  }

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (this.mode === 'idle') {
      // Hover highlight. Only redraw the active layer when the hovered shape actually changes.
      const hit = ctx.engine.hitTest(e.world.x, e.world.y);
      const id = hit?.id ?? null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        ctx.engine.markActiveDirty();
      }
      this.cursor = this.cursorForPoint(e.world, ctx);
      return;
    }


    switch (this.mode) {
      case 'marquee':
        this.marquee = normRect(this.startWorld, e.world);
        ctx.engine.markActiveDirty();
        break;
      case 'move':
        this.applyMove(e, ctx);
        break;
      case 'resize':
        this.applyResize(e, ctx);
        break;
      case 'rotate':
        this.applyRotate(e, ctx);
        break;
    }
  }

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    if (this.mode === 'marquee' && this.marquee) {
      const hits = ctx.engine.shapesInRect(this.marquee).map((s) => s.id);
      ctx.setSelection(hits);
    }

    // Authoritative final write. During the drag we throttle to ~30Hz; this guarantees the
    // document ends up with the exact final value regardless of throttle timing.
    if (this.mode === 'move' || this.mode === 'resize' || this.mode === 'rotate') {
      this.commit(ctx);
    }

    this.mode = 'idle';
    this.marquee = null;
    this.handle = null;
    this.guides = [];
    this.originals.clear();
    this.originalBounds = null;
    ctx.engine.setInteracting(false);
    ctx.engine.markActiveDirty();
  }

  onDoubleClick(e: CanvasPointerEvent, ctx: ToolContext): void {
    const hit = ctx.engine.hitTest(e.world.x, e.world.y);
    if (!hit) return;
    if (hit.type === 'sticky' || hit.type === 'text' || hit.type === 'rect' || hit.type === 'ellipse') {
      ctx.editText(hit);
    }
  }

  onCancel(ctx: ToolContext): void {
    // Restore the pre-drag state rather than leaving shapes wherever the pointer happened to be.
    if (this.originals.size > 0) {
      for (const original of this.originals.values()) ctx.engine.putShape(original);
      ctx.doc.updateMany(
        [...this.originals.values()].map((s) => ({ id: s.id, patch: s as Partial<Shape> })),
      );
    }
    this.mode = 'idle';
    this.marquee = null;
    this.originals.clear();
    this.guides = [];
    ctx.engine.setInteracting(false);
    ctx.engine.markActiveDirty();
  }

  // -------------------------------------------------------------------------

  private snapshot(ctx: ToolContext, ids: ShapeId[]): void {
    this.originals.clear();
    const shapes: Shape[] = [];
    for (const id of ids) {
      const s = ctx.engine.getShape(id);
      if (!s || s.locked) continue;
      this.originals.set(id, structuredClone(s));
      shapes.push(s);
    }
    this.originalBounds = shapesBounds(shapes);
    this.lastWriteAt = 0;
  }

  private applyMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.originalBounds) return;
    let dx = e.world.x - this.startWorld.x;
    let dy = e.world.y - this.startWorld.y;

    // Shift constrains to the dominant axis.
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    // ctrl temporarily disables snapping — the standard escape hatch for precise placement.
    if (!e.ctrlKey && !e.metaKey) {
      const moved: Rect = {
        x: this.originalBounds.x + dx,
        y: this.originalBounds.y + dy,
        w: this.originalBounds.w,
        h: this.originalBounds.h,
      };
      const snap = computeSnap(ctx.engine, moved, new Set(this.originals.keys()));
      dx += snap.dx;
      dy += snap.dy;
      this.guides = snap.guides;
    } else {
      this.guides = [];
    }

    const patches: Array<{ id: ShapeId; patch: Partial<Shape> }> = [];
    for (const original of this.originals.values()) {
      const next = { ...original, x: original.x + dx, y: original.y + dy } as Shape;
      // Update the engine every frame for an immediate, smooth local drag...
      ctx.engine.putShape(next);
      patches.push({ id: next.id, patch: { x: next.x, y: next.y } });
    }
    // ...but throttle the CRDT write. 120 updates/sec floods every peer and produces a history
    // nobody can undo through sensibly.
    this.throttledWrite(ctx, patches);
    ctx.engine.markActiveDirty();
  }

  private applyResize(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.originalBounds || !this.handle) return;
    const b = this.originalBounds;
    const dx = e.world.x - this.startWorld.x;
    const dy = e.world.y - this.startWorld.y;

    let nx = b.x;
    let ny = b.y;
    let nw = b.w;
    let nh = b.h;

    const h = this.handle;
    if (h.includes('w')) {
      nx = b.x + dx;
      nw = b.w - dx;
    }
    if (h.includes('e')) nw = b.w + dx;
    if (h.includes('n')) {
      ny = b.y + dy;
      nh = b.h - dy;
    }
    if (h.includes('s')) nh = b.h + dy;

    // Shift preserves aspect ratio on corner handles.
    if (e.shiftKey && h.length === 2 && b.w > 0 && b.h > 0) {
      const ratio = b.w / b.h;
      if (Math.abs(nw / ratio) > Math.abs(nh)) nh = nw / ratio;
      else nw = nh * ratio;
      if (h.includes('n')) ny = b.y + b.h - nh;
      if (h.includes('w')) nx = b.x + b.w - nw;
    }

    // Below ~2 world units a shape becomes unselectable and effectively lost.
    const MIN = 2;
    if (Math.abs(nw) < MIN) nw = MIN;
    if (Math.abs(nh) < MIN) nh = MIN;

    const scaleX = b.w === 0 ? 1 : nw / b.w;
    const scaleY = b.h === 0 ? 1 : nh / b.h;

    const patches: Array<{ id: ShapeId; patch: Partial<Shape> }> = [];
    for (const original of this.originals.values()) {
      const relX = (original.x - b.x) * scaleX;
      const relY = (original.y - b.y) * scaleY;
      const next = {
        ...original,
        x: nx + relX,
        y: ny + relY,
        w: original.w * scaleX,
        h: original.h * scaleY,
      } as Shape;

      // Path shapes carry their geometry in `points`, so scaling w/h alone would leave the
      // stroke unchanged inside a resized box.
      if (isPathLike(next) && isPathLike(original)) {
        next.points = original.points.map(([px, py]) => [px * scaleX, py * scaleY] as [number, number]);
        patches.push({ id: next.id, patch: { x: next.x, y: next.y, w: next.w, h: next.h, points: next.points } as Partial<Shape> });
      } else {
        patches.push({ id: next.id, patch: { x: next.x, y: next.y, w: next.w, h: next.h } });
      }
      ctx.engine.putShape(next);
    }
    this.throttledWrite(ctx, patches);
    ctx.engine.markActiveDirty();
  }

  private applyRotate(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!this.originalBounds) return;
    const cx = this.originalBounds.x + this.originalBounds.w / 2;
    const cy = this.originalBounds.y + this.originalBounds.h / 2;

    const startAngle = Math.atan2(this.startWorld.y - cy, this.startWorld.x - cx);
    const nowAngle = Math.atan2(e.world.y - cy, e.world.x - cx);
    let delta = nowAngle - startAngle;

    // Shift snaps to 15° increments.
    if (e.shiftKey) {
      const step = Math.PI / 12;
      delta = Math.round(delta / step) * step;
    }

    const patches: Array<{ id: ShapeId; patch: Partial<Shape> }> = [];
    for (const original of this.originals.values()) {
      const ocx = original.x + original.w / 2;
      const ocy = original.y + original.h / 2;
      // Multi-select rotates about the GROUP centre, so each shape orbits as well as spins.
      const p = rotatePoint(ocx, ocy, cx, cy, delta);
      const next = {
        ...original,
        x: p.x - original.w / 2,
        y: p.y - original.h / 2,
        rotation: original.rotation + delta,
      } as Shape;
      ctx.engine.putShape(next);
      patches.push({ id: next.id, patch: { x: next.x, y: next.y, rotation: next.rotation } });
    }
    this.throttledWrite(ctx, patches);
    ctx.engine.markActiveDirty();
  }

  private throttledWrite(
    ctx: ToolContext,
    patches: Array<{ id: ShapeId; patch: Partial<Shape> }>,
  ): void {
    const now = performance.now();
    if (now - this.lastWriteAt < DRAG_WRITE_THROTTLE_MS) return;
    this.lastWriteAt = now;
    ctx.doc.updateMany(patches);
  }

  private commit(ctx: ToolContext): void {
    const patches: Array<{ id: ShapeId; patch: Partial<Shape> }> = [];
    for (const id of this.originals.keys()) {
      const current = ctx.engine.getShape(id);
      if (!current) continue;
      patches.push({ id, patch: current as Partial<Shape> });
    }
    if (patches.length === 0) return;
    ctx.doc.updateMany(patches);
    // A finished move/resize/rotate is one undo step, and must not merge with whatever the
    // user does next (or with the create that may have just preceded it).
    ctx.doc.breakUndoGroup();
  }

  // -------------------------------------------------------------------------

  private handleRects(ctx: ToolContext): Array<{ handle: Handle; rect: Rect }> {
    const sel = ctx.getSelection();
    if (sel.length === 0) return [];
    const shapes = sel.map((id) => ctx.engine.getShape(id)).filter(Boolean) as Shape[];
    const b = shapesBounds(shapes);
    if (!b) return [];

    const zoom = ctx.engine.camera.zoom;
    const s = HANDLE_SCREEN_PX / zoom;
    const half = s / 2;

    const pts: Array<[Handle, number, number]> = [
      ['nw', b.x, b.y],
      ['n', b.x + b.w / 2, b.y],
      ['ne', b.x + b.w, b.y],
      ['e', b.x + b.w, b.y + b.h / 2],
      ['se', b.x + b.w, b.y + b.h],
      ['s', b.x + b.w / 2, b.y + b.h],
      ['sw', b.x, b.y + b.h],
      ['w', b.x, b.y + b.h / 2],
      ['rotate', b.x + b.w / 2, b.y - ROTATE_OFFSET_PX / zoom],
    ];

    return pts.map(([handle, x, y]) => ({
      handle,
      rect: { x: x - half, y: y - half, w: s, h: s },
    }));
  }

  private hitHandle(world: { x: number; y: number }, ctx: ToolContext): Handle | null {
    for (const { handle, rect } of this.handleRects(ctx)) {
      if (
        world.x >= rect.x &&
        world.x <= rect.x + rect.w &&
        world.y >= rect.y &&
        world.y <= rect.y + rect.h
      ) {
        return handle;
      }
    }
    return null;
  }

  private cursorForPoint(world: { x: number; y: number }, ctx: ToolContext): string {
    const handle = this.hitHandle(world, ctx);
    if (handle === 'rotate') return 'grab';
    if (handle) {
      const map: Record<string, string> = {
        nw: 'nwse-resize', se: 'nwse-resize',
        ne: 'nesw-resize', sw: 'nesw-resize',
        n: 'ns-resize', s: 'ns-resize',
        e: 'ew-resize', w: 'ew-resize',
      };
      return map[handle] ?? 'default';
    }
    return ctx.engine.hitTest(world.x, world.y) ? 'move' : 'default';
  }

  // -------------------------------------------------------------------------

  drawPreview(rc: CanvasRenderingContext2D, camera: Camera, ctx: ToolContext): void {
    const zoom = camera.zoom;
    const theme = ctx.engine.getTheme();

    // Hover outline — only when nothing is selected, so it does not fight the selection UI.
    if (this.mode === 'idle' && this.hoverId && !ctx.getSelection().includes(this.hoverId)) {
      const s = ctx.engine.getShape(this.hoverId);
      if (s) {
        const b = shapeBounds(s);
        rc.strokeStyle = theme.chromeFgDim;
        rc.lineWidth = 1 / zoom;
        rc.setLineDash([]);
        rc.strokeRect(b.x, b.y, b.w, b.h);
      }
    }

    if (this.marquee) {
      rc.fillStyle = 'rgba(120,130,150,.12)';
      rc.strokeStyle = theme.canvasInk;
      rc.lineWidth = 1 / zoom;
      rc.setLineDash([4 / zoom, 3 / zoom]);
      rc.fillRect(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
      rc.strokeRect(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
      rc.setLineDash([]);
    }

    drawSnapGuides(rc, this.guides, zoom);

    const sel = ctx.getSelection();
    if (sel.length === 0) return;

    const shapes = sel.map((id) => ctx.engine.getShape(id)).filter(Boolean) as Shape[];
    const b = shapesBounds(shapes);
    if (!b) return;

    rc.strokeStyle = theme.canvasInk;
    rc.lineWidth = 1.5 / zoom;
    rc.setLineDash([]);
    rc.strokeRect(b.x, b.y, b.w, b.h);

    // Handles are hidden mid-drag: they would be drawn at stale positions and just add noise.
    if (this.mode !== 'idle') return;

    rc.lineWidth = 1 / zoom;
    for (const { handle, rect } of this.handleRects(ctx)) {
      if (handle === 'rotate') {
        rc.beginPath();
        rc.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, 0, Math.PI * 2);
        rc.fillStyle = theme.canvasBg;
        rc.fill();
        rc.strokeStyle = theme.canvasInk;
        rc.stroke();
      } else {
        rc.fillStyle = theme.canvasBg;
        rc.fillRect(rect.x, rect.y, rect.w, rect.h);
        rc.strokeStyle = theme.canvasInk;
        rc.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
    }
  }
}

function normRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
