import { GRID_CELL_SIZE } from '@board/shared';
import type { ShapeId } from '@board/shared';
import type { Rect } from './geometry.js';

/**
 * Uniform-grid spatial index.
 *
 * WHY A GRID AND NOT AN R-TREE — this is the tradeoff worth defending:
 *
 * In this workload insert/update cost dominates. Shapes move continuously during drags, and a
 * multi-shape drag re-indexes every selected shape on every frame. Grid updates are a handful of
 * Set operations; R-tree rebalancing is not. An R-tree wins on query for sparse, mostly-static
 * data — which is the opposite of a whiteboard mid-drag.
 *
 * The grid's weakness is real and worth naming: a shape far larger than the cell size touches
 * many cells. Frames are the only such shapes here, and there are few of them.
 */
export class SpatialIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<ShapeId>>();
  private readonly bounds = new Map<ShapeId, Rect>();

  constructor(cellSize: number = GRID_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.bounds.size;
  }

  /** Number of occupied cells — surfaced in the perf HUD as evidence the index is doing work. */
  get cellCount(): number {
    return this.cells.size;
  }

  insert(id: ShapeId, rect: Rect): void {
    if (this.bounds.has(id)) {
      this.update(id, rect);
      return;
    }
    this.bounds.set(id, rect);
    this.forEachCell(rect, (key) => {
      let cell = this.cells.get(key);
      if (!cell) {
        cell = new Set();
        this.cells.set(key, cell);
      }
      cell.add(id);
    });
  }

  remove(id: ShapeId): void {
    const rect = this.bounds.get(id);
    if (!rect) return;
    this.forEachCell(rect, (key) => {
      const cell = this.cells.get(key);
      if (!cell) return;
      cell.delete(id);
      // Drop empty cells so cellCount stays meaningful and the map does not grow forever
      // on a board where shapes are repeatedly created and deleted.
      if (cell.size === 0) this.cells.delete(key);
    });
    this.bounds.delete(id);
  }

  /**
   * Reposition an existing shape.
   *
   * Fast path: if the covered cell range is unchanged, only the stored bounds need updating.
   * During a drag this is the overwhelmingly common case, and it turns a re-index into a single
   * Map.set.
   */
  update(id: ShapeId, rect: Rect): void {
    const prev = this.bounds.get(id);
    if (!prev) {
      this.insert(id, rect);
      return;
    }
    if (this.sameCellRange(prev, rect)) {
      this.bounds.set(id, rect);
      return;
    }
    this.remove(id);
    this.insert(id, rect);
  }

  /** Candidate ids whose cells overlap `rect`. Deduped; still needs a precise bounds check. */
  query(rect: Rect): ShapeId[] {
    const seen = new Set<ShapeId>();
    this.forEachCell(rect, (key) => {
      const cell = this.cells.get(key);
      if (!cell) return;
      for (const id of cell) seen.add(id);
    });
    return [...seen];
  }

  queryPoint(x: number, y: number): ShapeId[] {
    return this.query({ x, y, w: 0, h: 0 });
  }

  getBounds(id: ShapeId): Rect | undefined {
    return this.bounds.get(id);
  }

  clear(): void {
    this.cells.clear();
    this.bounds.clear();
  }

  /** Union of every indexed shape's bounds. Used by zoom-to-fit and whole-board export. */
  totalBounds(): Rect | null {
    if (this.bounds.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of this.bounds.values()) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // -------------------------------------------------------------------------

  private cellRange(rect: Rect) {
    const c = this.cellSize;
    return {
      x0: Math.floor(rect.x / c),
      y0: Math.floor(rect.y / c),
      x1: Math.floor((rect.x + rect.w) / c),
      y1: Math.floor((rect.y + rect.h) / c),
    };
  }

  private sameCellRange(a: Rect, b: Rect): boolean {
    const ra = this.cellRange(a);
    const rb = this.cellRange(b);
    return ra.x0 === rb.x0 && ra.y0 === rb.y0 && ra.x1 === rb.x1 && ra.y1 === rb.y1;
  }

  /**
   * String keys rather than a packed integer: correctness over a micro-optimisation that would
   * silently break on negative or very large coordinates. Keys are only built for cells actually
   * touched — at typical zoom a viewport query builds tens of keys, not thousands.
   */
  private forEachCell(rect: Rect, fn: (key: string) => void): void {
    const { x0, y0, x1, y1 } = this.cellRange(rect);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) fn(`${cx}:${cy}`);
    }
  }
}
