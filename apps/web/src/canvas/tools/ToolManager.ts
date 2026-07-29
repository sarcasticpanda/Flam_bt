import type { Camera, Engine } from '@board/canvas-engine';
import { shapesBounds } from '@board/canvas-engine';
import { STICKY_COLORS, isPathLike, newShapeId, type Shape, type ShapeId } from '@board/shared';
import type { BoardDoc } from '../../collab/BoardDoc';
import type { CanvasPointerEvent, StyleDefaults, Tool, ToolContext, ToolId } from './types';
import { SelectTool } from './SelectTool';
import {
  BoxTool,
  EraserTool,
  HandTool,
  LineTool,
  PenTool,
  StickyTool,
  TextTool,
  reflowBoundArrows,
} from './DrawTools';

export const DEFAULT_STYLE: StyleDefaults = {
  stroke: 'var(--canvas-ink)',
  fill: 'transparent',
  strokeWidth: 2,
  dash: 'solid',
  opacity: 1,
  fontSize: 18,
  textAlign: 'center',
  stickyColor: STICKY_COLORS[0],
};

/**
 * Routes input to the active tool and owns everything that is not tool-specific: selection,
 * clipboard, z-order, nudging, and the keyboard map.
 *
 * Kept out of React entirely. Chrome subscribes via `onChange` and re-renders only when
 * something it displays actually changes — tool, selection count, style defaults.
 */
export class ToolManager {
  private tools: Record<ToolId, Tool>;
  private activeId: ToolId = 'select';
  private selection: ShapeId[] = [];
  private clipboard: Shape[] = [];

  style: StyleDefaults = { ...DEFAULT_STYLE };

  /** Chrome subscribes here. Fired only on state chrome actually displays. */
  onChange: (() => void) | null = null;
  /** Opens the inline on-canvas text editor. */
  onEditText: ((shape: Shape) => void) | null = null;

  private readonly ctx: ToolContext;

  constructor(
    private readonly engine: Engine,
    private readonly doc: BoardDoc,
    userId: string,
  ) {
    this.ctx = {
      engine,
      doc,
      userId,
      // A getter, so tools always read the CURRENT defaults rather than a snapshot taken here.
      get style() {
        return manager.style;
      },
      getSelection: () => this.selection,
      setSelection: (ids) => this.setSelection(ids),
      setTool: (id) => this.setTool(id),
      editText: (shape) => this.onEditText?.(shape),
      notify: () => this.onChange?.(),
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const manager = this;

    this.tools = {
      select: new SelectTool(),
      hand: new HandTool(),
      pen: new PenTool('pen'),
      highlighter: new PenTool('highlighter'),
      eraser: new EraserTool(),
      rect: new BoxTool('rect'),
      ellipse: new BoxTool('ellipse'),
      line: new LineTool('line'),
      arrow: new LineTool('arrow'),
      text: new TextTool(),
      sticky: new StickyTool(),
    };

    engine.activePainter = (rc: CanvasRenderingContext2D, camera: Camera) => {
      this.active.drawPreview?.(rc, camera, this.ctx);
    };
  }

  get active(): Tool {
    return this.tools[this.activeId];
  }

  get activeToolId(): ToolId {
    return this.activeId;
  }

  get cursor(): string {
    return this.active.cursor;
  }

  getSelection(): ShapeId[] {
    return this.selection;
  }

  // -------------------------------------------------------------------------

  setTool(id: ToolId): void {
    if (id === this.activeId) return;
    this.active.onDeactivate?.(this.ctx);
    this.active.onCancel(this.ctx);
    this.activeId = id;
    // Leaving select with a live selection is confusing — the handles imply you can still drag.
    if (id !== 'select') this.setSelection([]);
    this.engine.markActiveDirty();
    this.onChange?.();
  }

  setSelection(ids: ShapeId[]): void {
    const changed =
      ids.length !== this.selection.length || ids.some((id, i) => this.selection[i] !== id);
    this.selection = ids;
    this.engine.markActiveDirty();
    if (changed) this.onChange?.();
  }

  setStyle(patch: Partial<StyleDefaults>): void {
    this.style = { ...this.style, ...patch };

    // With a selection, restyle it. With nothing selected, this sets the default for the next
    // shape — the behaviour people expect and immediately notice when it is missing.
    if (this.selection.length > 0) {
      const patches = this.selection.map((id) => {
        const shape = this.engine.getShape(id);
        const p: Record<string, unknown> = {};
        if (patch.stroke !== undefined && shape && 'stroke' in shape) p.stroke = patch.stroke;
        if (patch.fill !== undefined && shape && 'fill' in shape) p.fill = patch.fill;
        if (patch.strokeWidth !== undefined && shape && 'strokeWidth' in shape) {
          p.strokeWidth = patch.strokeWidth;
        }
        if (patch.dash !== undefined && shape && 'dash' in shape) p.dash = patch.dash;
        if (patch.opacity !== undefined) p.opacity = patch.opacity;
        if (patch.fontSize !== undefined && shape && 'fontSize' in shape) p.fontSize = patch.fontSize;
        if (patch.stickyColor !== undefined && shape?.type === 'sticky') p.color = patch.stickyColor;
        return { id, patch: p as Partial<Shape> };
      });
      this.doc.updateMany(patches);
    }
    this.onChange?.();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  pointerDown(e: CanvasPointerEvent): void {
    this.active.onPointerDown(e, this.ctx);
  }

  pointerMove(e: CanvasPointerEvent): void {
    this.active.onPointerMove(e, this.ctx);
  }

  pointerUp(e: CanvasPointerEvent): void {
    this.active.onPointerUp(e, this.ctx);
    // Arrows bound to a moved shape must follow it. Done after the tool commits so it operates
    // on final positions, not mid-drag ones.
    if (this.selection.length > 0) reflowBoundArrows(this.ctx, new Set(this.selection));
  }

  doubleClick(e: CanvasPointerEvent): void {
    this.active.onDoubleClick?.(e, this.ctx);
  }

  cancel(): void {
    this.active.onCancel(this.ctx);
  }

  // -------------------------------------------------------------------------
  // Object operations
  // -------------------------------------------------------------------------

  deleteSelection(): void {
    if (this.selection.length === 0) return;
    this.doc.delete(this.selection);
    this.setSelection([]);
  }

  duplicateSelection(offset = 24): void {
    if (this.selection.length === 0) return;
    const zs = this.doc.nextZ(this.selection.length);
    const copies: Shape[] = [];
    this.selection.forEach((id, i) => {
      const s = this.engine.getShape(id);
      if (!s) return;
      copies.push({
        ...structuredClone(s),
        id: newShapeId(),
        x: s.x + offset,
        y: s.y + offset,
        z: zs[i]!,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Shape);
    });
    if (copies.length === 0) return;
    this.doc.addMany(copies);
    this.setSelection(copies.map((c) => c.id));
  }

  copySelection(): void {
    this.clipboard = this.selection
      .map((id) => this.engine.getShape(id))
      .filter(Boolean)
      .map((s) => structuredClone(s!));
  }

  paste(atWorld?: { x: number; y: number }): void {
    if (this.clipboard.length === 0) return;
    const b = shapesBounds(this.clipboard);
    const zs = this.doc.nextZ(this.clipboard.length);
    // Paste centred on the cursor when we have one, otherwise nudge off the original.
    const dx = atWorld && b ? atWorld.x - (b.x + b.w / 2) : 24;
    const dy = atWorld && b ? atWorld.y - (b.y + b.h / 2) : 24;

    const copies = this.clipboard.map((s, i) => ({
      ...structuredClone(s),
      id: newShapeId(),
      x: s.x + dx,
      y: s.y + dy,
      z: zs[i]!,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })) as Shape[];

    this.doc.addMany(copies);
    this.setSelection(copies.map((c) => c.id));
  }

  selectAll(): void {
    this.setSelection(this.engine.allShapes().filter((s) => !s.locked).map((s) => s.id));
  }

  nudge(dx: number, dy: number): void {
    if (this.selection.length === 0) return;
    const patches = this.selection.map((id) => {
      const s = this.engine.getShape(id)!;
      return { id, patch: { x: s.x + dx, y: s.y + dy } as Partial<Shape> };
    });
    this.doc.updateMany(patches);
    reflowBoundArrows(this.ctx, new Set(this.selection));
  }

  bringToFront(): void {
    if (this.selection.length > 0) this.doc.bringToFront(this.selection);
  }

  sendToBack(): void {
    if (this.selection.length > 0) this.doc.sendToBack(this.selection);
  }

  zoomToSelection(): void {
    const shapes = this.selection.map((id) => this.engine.getShape(id)).filter(Boolean) as Shape[];
    const b = shapesBounds(shapes);
    if (!b) return;
    this.engine.camera.fitTo(b, this.engine.width, this.engine.height);
    this.engine.markDirty();
    this.engine.markOverlayDirty();
  }

  /** Commit inline text edits back into the document. */
  commitText(id: ShapeId, text: string): void {
    const shape = this.engine.getShape(id);
    if (!shape) return;

    // An empty text shape is invisible and unselectable — delete rather than orphan it.
    if (shape.type === 'text' && text.trim() === '') {
      this.doc.delete([id]);
      this.setSelection([]);
      return;
    }

    const patch: Partial<Shape> = { text } as Partial<Shape>;
    if (shape.type === 'text' && shape.autoWidth) {
      const lines = text.split('\n');
      const longest = Math.max(...lines.map((l) => l.length), 1);
      Object.assign(patch, {
        w: Math.max(40, longest * shape.fontSize * 0.56),
        h: lines.length * shape.fontSize * 1.35,
      });
    }
    this.doc.update(id, patch);
  }

  /** True when the selection contains a path shape — used to disable irrelevant style controls. */
  selectionHasPath(): boolean {
    return this.selection.some((id) => {
      const s = this.engine.getShape(id);
      return s ? isPathLike(s) : false;
    });
  }
}
