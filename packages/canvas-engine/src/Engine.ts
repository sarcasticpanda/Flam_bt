import type { Shape, ShapeId } from '@board/shared';
import { CULL_PADDING, LOD_MICRO_THRESHOLD, LOD_ZOOM_THRESHOLD } from '@board/shared';
import { Camera } from './Camera.js';
import { SpatialIndex } from './SpatialIndex.js';
import { pointInShape, shapeBounds, rectIntersects, type Rect } from './geometry.js';
import { drawShape, setImageLoadCallback } from './renderers.js';
import { DEFAULT_THEME, readThemeFromDOM, type ThemeColors } from './theme.js';

export interface EngineStats {
  fps: number;
  msFrame: number;
  msCull: number;
  msDraw: number;
  total: number;
  visible: number;
  culledPct: number;
  cells: number;
  idle: boolean;
}

export type OverlayPainter = (ctx: CanvasRenderingContext2D, camera: Camera) => void;

/**
 * The rendering engine.
 *
 * Framework-agnostic by construction: no React, no Yjs. That constraint is what makes it
 * testable, and it is also what keeps shape state out of React — see CLAUDE.md rule 3.
 *
 * Three stacked canvases (docs/02-ARCHITECTURE.md §6):
 *   static  — committed shapes, redrawn only when the document or camera changes
 *   active  — the shape being drawn/dragged, selection UI; redrawn during interaction
 *   overlay — remote cursors and presence; its own cheap loop
 *
 * The split is not cosmetic. A pen stroke redrawn on the static layer forces all 10,000 shapes
 * to redraw every frame; on the active layer it costs one path.
 */
export class Engine {
  readonly camera = new Camera();
  readonly index = new SpatialIndex();
  readonly shapes = new Map<ShapeId, Shape>();

  private readonly container: HTMLElement;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly activeCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D;
  private readonly activeCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;

  private theme: ThemeColors = DEFAULT_THEME;
  private gridMode: 'none' | 'dot' | 'line' = 'dot';

  private dirty = true;
  private activeDirty = true;
  private overlayDirty = true;
  private interacting = false;

  private rafId = 0;
  private running = false;

  width = 0;
  height = 0;

  /** Painters owned by the app layer, so the engine stays ignorant of tools and presence. */
  activePainter: OverlayPainter | null = null;
  overlayPainter: OverlayPainter | null = null;

  private frameTimes: number[] = [];
  private lastFrame = 0;
  stats: EngineStats = {
    fps: 0,
    msFrame: 0,
    msCull: 0,
    msDraw: 0,
    total: 0,
    visible: 0,
    culledPct: 0,
    cells: 0,
    idle: true,
  };

  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.staticCanvas = makeLayer(container, 1);
    this.activeCanvas = makeLayer(container, 2);
    this.overlayCanvas = makeLayer(container, 3);

    this.staticCtx = ctx2d(this.staticCanvas);
    this.activeCtx = ctx2d(this.activeCanvas);
    this.overlayCtx = ctx2d(this.overlayCanvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    // An image arriving after its shape was drawn must trigger a redraw, or it stays invisible
    // until something unrelated marks the canvas dirty.
    setImageLoadCallback(() => this.markDirty());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.staticCanvas.remove();
    this.activeCanvas.remove();
    this.overlayCanvas.remove();
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    // HiDPI: a canvas without devicePixelRatio scaling is visibly blurry on any modern display,
    // and it is the first thing anyone notices.
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.camera.dpr = dpr;

    for (const c of [this.staticCanvas, this.activeCanvas, this.overlayCanvas]) {
      c.width = Math.max(1, Math.floor(rect.width * dpr));
      c.height = Math.max(1, Math.floor(rect.height * dpr));
      c.style.width = `${rect.width}px`;
      c.style.height = `${rect.height}px`;
    }
    this.markDirty();
    this.markOverlayDirty();
  }

  // -------------------------------------------------------------------------
  // Dirty tracking — an idle board must cost ~0% CPU
  // -------------------------------------------------------------------------

  markDirty(): void {
    this.dirty = true;
    this.activeDirty = true;
  }

  markActiveDirty(): void {
    this.activeDirty = true;
  }

  markOverlayDirty(): void {
    this.overlayDirty = true;
  }

  setInteracting(v: boolean): void {
    this.interacting = v;
    if (v) this.activeDirty = true;
  }

  // -------------------------------------------------------------------------
  // Document
  // -------------------------------------------------------------------------

  setShapes(shapes: Iterable<Shape>): void {
    this.shapes.clear();
    this.index.clear();
    for (const s of shapes) {
      this.shapes.set(s.id, s);
      this.index.insert(s.id, shapeBounds(s));
    }
    this.markDirty();
  }

  putShape(shape: Shape): void {
    this.shapes.set(shape.id, shape);
    this.index.update(shape.id, shapeBounds(shape));
    this.markDirty();
  }

  removeShape(id: ShapeId): void {
    this.shapes.delete(id);
    this.index.remove(id);
    this.markDirty();
  }

  getShape(id: ShapeId): Shape | undefined {
    return this.shapes.get(id);
  }

  allShapes(): Shape[] {
    return [...this.shapes.values()];
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Visible shapes, culled then sorted. Never sorts the full document. */
  visibleShapes(): Shape[] {
    const viewport = this.camera.worldViewport(this.width, this.height, CULL_PADDING);
    const ids = this.index.query(viewport);
    const out: Shape[] = [];
    for (const id of ids) {
      const s = this.shapes.get(id);
      if (!s) continue;
      // Use the bounds the index ALREADY stores. Recomputing shapeBounds() here re-walks every
      // point of every pen stroke on every frame — measured at 17.5ms/frame with 10k shapes
      // in view, which alone put the zoomed-out case under 30fps.
      const b = this.index.getBounds(id);
      if (b && !rectIntersects(b, viewport)) continue;
      out.push(s);
    }
    out.sort(sortByZ);
    return out;
  }

  /** Topmost shape at a world point, or null. */
  hitTest(wx: number, wy: number): Shape | null {
    const tolerance = 6 / this.camera.zoom;
    const ids = this.index.query({ x: wx - tolerance, y: wy - tolerance, w: tolerance * 2, h: tolerance * 2 });
    let best: Shape | null = null;
    for (const id of ids) {
      const s = this.shapes.get(id);
      if (!s || s.locked) continue;
      if (!pointInShape(s, wx, wy, tolerance)) continue;
      // Sort order is by z, so the last match wins — that is the topmost shape.
      if (!best || s.z > best.z) best = s;
    }
    return best;
  }

  /** Shapes fully inside a world rect. Marquee selection. */
  shapesInRect(rect: Rect): Shape[] {
    const out: Shape[] = [];
    for (const id of this.index.query(rect)) {
      const s = this.shapes.get(id);
      if (!s || s.locked) continue;
      const b = shapeBounds(s);
      if (b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h) {
        out.push(s);
      }
    }
    return out.sort(sortByZ);
  }

  // -------------------------------------------------------------------------
  // Theme & grid
  // -------------------------------------------------------------------------

  refreshTheme(): void {
    this.theme = readThemeFromDOM(this.container);
    this.markDirty();
    this.markOverlayDirty();
  }

  getTheme(): ThemeColors {
    return this.theme;
  }

  setGridMode(mode: 'none' | 'dot' | 'line'): void {
    this.gridMode = mode;
    this.markDirty();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  /**
   * Run one full cull + draw pass on the static layer, synchronously, updating stats.
   *
   * Public because two things need a render that is not tied to the rAF loop:
   *   - PNG export, which must draw the whole board off-cycle
   *   - benchmarking, since headless browsers throttle rAF to 1Hz and make end-to-end frame
   *     cadence meaningless as a measure of engine cost
   */
  renderStaticNow(): void {
    const cullStart = performance.now();
    const visible = this.visibleShapes();
    const msCull = performance.now() - cullStart;

    const drawStart = performance.now();
    this.drawStaticLayer(visible);
    const msDraw = performance.now() - drawStart;

    this.stats.msCull = msCull;
    this.stats.msDraw = msDraw;
    this.stats.visible = visible.length;
    this.stats.total = this.shapes.size;
    this.stats.cells = this.index.cellCount;
    this.stats.culledPct =
      this.shapes.size === 0 ? 0 : (1 - visible.length / this.shapes.size) * 100;
    this.dirty = false;
  }

  private frame(now: number): void {
    const delta = now - this.lastFrame;
    this.lastFrame = now;

    // The whole point of the dirty flag: a board nobody is touching costs nothing.
    if (!this.dirty && !this.activeDirty && !this.overlayDirty && !this.interacting) {
      this.stats.idle = true;
      this.stats.fps = 0;
      return;
    }
    this.stats.idle = false;

    const t0 = performance.now();

    if (this.dirty) this.renderStaticNow();

    if (this.activeDirty || this.interacting) {
      this.clearLayer(this.activeCtx, this.activeCanvas);
      if (this.activePainter) {
        this.camera.applyTransform(this.activeCtx);
        this.activePainter(this.activeCtx, this.camera);
      }
      this.activeDirty = false;
    }

    if (this.overlayDirty) {
      this.clearLayer(this.overlayCtx, this.overlayCanvas);
      if (this.overlayPainter) {
        this.camera.applyTransform(this.overlayCtx);
        this.overlayPainter(this.overlayCtx, this.camera);
      }
      this.overlayDirty = false;
    }

    this.stats.msFrame = performance.now() - t0;

    // Rolling average over ~30 frames — an instantaneous reading jitters too much to read.
    this.frameTimes.push(delta);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.fps = avg > 0 ? Math.round(1000 / avg) : 0;
  }

  private clearLayer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  private drawStaticLayer(visible: Shape[]): void {
    const ctx = this.staticCtx;
    this.clearLayer(ctx, this.staticCanvas);

    ctx.fillStyle = this.theme.canvasBg;
    ctx.fillRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);

    this.drawGrid(ctx);

    this.camera.applyTransform(ctx);
    const zoom = this.camera.zoom;

    // Far-zoom LOD. Below 10% no shape is legible, so per-shape styling buys nothing while
    // costing a full ctx state change each. Two batched fills convey density and the sticky
    // colour signal, which is all that survives at this scale anyway.
    if (zoom < LOD_MICRO_THRESHOLD) {
      this.drawMicroBatch(ctx, visible);
      return;
    }

    const r = { ctx, zoom, theme: this.theme };
    for (const shape of visible) {
      // While a shape's text is being edited, the contenteditable overlay IS the text. Drawing
      // it underneath as well produces a visible double-render offset by a pixel or two.
      if (shape.id === this.editingShapeId && 'text' in shape) {
        if (shape.type === 'text') continue;
        drawShape(r, { ...shape, text: '' } as Shape);
        continue;
      }
      drawShape(r, shape);
    }
  }

  /** Set while an inline text editor is open over a shape. */
  editingShapeId: ShapeId | null = null;

  setEditing(id: ShapeId | null): void {
    this.editingShapeId = id;
    this.markDirty();
  }

  /**
   * Far-zoom batch render.
   *
   * Grouped by fill colour so the whole visible set costs ~9 `fillStyle` assignments instead of
   * one per shape. Setting fillStyle is a parse + state write; at ~4,500 shapes doing it per
   * shape measured as the dominant cost of this path.
   */
  private drawMicroBatch(ctx: CanvasRenderingContext2D, visible: Shape[]): void {
    const byColor = new Map<string, Shape[]>();
    const ink: Shape[] = [];

    for (const s of visible) {
      if (s.type === 'sticky') {
        let bucket = byColor.get(s.color);
        if (!bucket) byColor.set(s.color, (bucket = []));
        bucket.push(s);
      } else {
        ink.push(s);
      }
    }

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = this.theme.canvasInk;
    for (const s of ink) ctx.fillRect(s.x, s.y, s.w < 2 ? 2 : s.w, s.h < 2 ? 2 : s.h);

    // Sticky colour is the one piece of information still readable at this zoom — it is how you
    // spot a cluster from across the board, so it survives LOD when everything else does not.
    ctx.globalAlpha = 1;
    for (const [color, shapes] of byColor) {
      ctx.fillStyle = color;
      for (const s of shapes) ctx.fillRect(s.x, s.y, s.w < 2 ? 2 : s.w, s.h < 2 ? 2 : s.h);
    }
  }

  /** Grid is drawn in SCREEN space — cheaper than transforming a world-space lattice. */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    if (this.gridMode === 'none') return;
    const { zoom } = this.camera;
    // Below 30% the grid becomes visual noise, so fade it out rather than drawing a grey wash.
    const alpha = zoom < 0.3 ? Math.max(0, (zoom - 0.15) / 0.15) : 1;
    if (alpha <= 0) return;

    let step = 40 * zoom;
    while (step < 12) step *= 4; // keep spacing readable as you zoom out
    while (step > 160) step /= 4;

    this.camera.resetTransform(ctx);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.theme.canvasGrid;
    ctx.strokeStyle = this.theme.canvasGrid;

    const offsetX = (-this.camera.x * zoom) % step;
    const offsetY = (-this.camera.y * zoom) % step;

    if (this.gridMode === 'dot') {
      const size = zoom > 1.5 ? 2 : 1.5;
      for (let x = offsetX; x < this.width; x += step) {
        for (let y = offsetY; y < this.height; y += step) {
          ctx.fillRect(x, y, size, size);
        }
      }
    } else {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = offsetX; x < this.width; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, this.height);
      }
      for (let y = offsetY; y < this.height; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(this.width, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** True when LOD simplification is active — surfaced in the HUD so the effect is visible. */
  get lodActive(): boolean {
    return this.camera.zoom < LOD_ZOOM_THRESHOLD;
  }
}

// ---------------------------------------------------------------------------

function sortByZ(a: Shape, b: Shape): number {
  return a.z < b.z ? -1 : a.z > b.z ? 1 : 0;
}

function makeLayer(container: HTMLElement, zIndex: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.style.position = 'absolute';
  c.style.inset = '0';
  c.style.zIndex = String(zIndex);
  // Only the top layer receives pointer events; the app forwards them to the tool manager.
  c.style.pointerEvents = 'none';
  c.style.touchAction = 'none';
  container.appendChild(c);
  return c;
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}
