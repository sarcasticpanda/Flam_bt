import * as Y from 'yjs';
import type { Engine } from '@board/canvas-engine';
import { shapeBounds } from '@board/canvas-engine';
import type { Shape, ShapeId, TransactionOrigin } from '@board/shared';
import { getShapes, shapeToYMap, yMapToShape, zSequence } from '@board/shared';

/**
 * The board document.
 *
 * Built on Yjs from the very first tool, deliberately, even though nothing is networked yet.
 * Yjs works perfectly well standalone, and building on a plain array first would mean auditing
 * and rewriting every mutation later — the single most reliable way to lose an afternoon and
 * introduce sync bugs (see docs, "C-04 before the provider, not after").
 *
 * Going live is then just attaching a provider. No mutation code changes.
 */
export class BoardDoc {
  readonly doc = new Y.Doc();
  readonly undoManager: Y.UndoManager;

  /**
   * A single STABLE origin object for this user's edits.
   *
   * Y.UndoManager matches tracked origins by identity, so a fresh `{userId, source}` literal per
   * transaction would never match and undo would silently do nothing. One object, reused.
   */
  readonly localOrigin: TransactionOrigin;

  private engine: Engine | null = null;
  private unobserve: (() => void) | null = null;

  /**
   * Fired after EVERY document change, local or remote, with the resulting shape count.
   *
   * Chrome needs this to know when the board stops being empty. Observing the shapes map
   * directly from React is unreliable — a top-level observer misses nested field changes, and
   * reading engine.shapes.size from inside it races the engine's own observer.
   */
  onShapeCount: ((count: number) => void) | null = null;

  constructor(readonly userId: string) {
    this.localOrigin = { userId, source: 'user' };
    this.aiOrigin = { userId, source: 'ai' };

    this.undoManager = new Y.UndoManager(getShapes(this.doc), {
      // Only THIS user's own edits are undoable. Undo must never revert a collaborator's work —
      // the most important correctness property in the whole realtime layer.
      trackedOrigins: new Set([this.localOrigin, this.aiOrigin]),
      captureTimeout: 400,
    });
  }

  /** AI results are undoable too, but tagged separately so collaborators can see attribution. */
  readonly aiOrigin: TransactionOrigin;

  // -------------------------------------------------------------------------

  get shapesMap(): Y.Map<Y.Map<unknown>> {
    return getShapes(this.doc);
  }

  /**
   * Mirror the document into the engine.
   *
   * Yjs is the source of truth; the engine store is a render-optimised projection of it. The
   * observer is the ONLY thing that writes into the engine, so local and remote edits take an
   * identical path — which means a bug can't affect one and not the other.
   */
  bindToEngine(engine: Engine): void {
    this.engine = engine;

    const shapes: Shape[] = [];
    this.shapesMap.forEach((yShape) => {
      const s = yMapToShape(yShape);
      if (s) shapes.push(s);
    });
    engine.setShapes(shapes);

    const observer = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      for (const event of events) {
        // Depth 0 = the shapes map itself: adds and deletes.
        if (event.path.length === 0) {
          event.changes.keys.forEach((change, id) => {
            if (change.action === 'delete') {
              engine.removeShape(id);
              return;
            }
            const yShape = this.shapesMap.get(id);
            if (!yShape) return;
            const shape = yMapToShape(yShape);
            if (shape) engine.putShape(shape);
          });
        } else {
          // Depth 1 = a field changed inside one shape.
          const id = String(event.path[0]);
          const yShape = this.shapesMap.get(id);
          if (!yShape) {
            engine.removeShape(id);
            continue;
          }
          const shape = yMapToShape(yShape);
          if (shape) engine.putShape(shape);
        }
      }
      engine.markDirty();
      // Emitted AFTER the engine store is updated, so the count is always accurate.
      this.onShapeCount?.(engine.shapes.size);
    };

    this.shapesMap.observeDeep(observer);
    this.unobserve = () => this.shapesMap.unobserveDeep(observer);

    // Seed the initial count — a board loaded from persistence already has shapes, and without
    // this the empty-state hint renders on top of them until the first edit.
    this.onShapeCount?.(engine.shapes.size);
  }

  destroy(): void {
    this.unobserve?.();
    this.unobserve = null;
    this.undoManager.destroy();
    this.doc.destroy();
  }

  // -------------------------------------------------------------------------
  // Mutations — every write to the document goes through one of these
  // -------------------------------------------------------------------------

  /** Wrap several mutations so a single ctrl+Z undoes all of them together. */
  batch(fn: () => void, origin: TransactionOrigin = this.localOrigin): void {
    this.doc.transact(fn, origin);
  }

  add(shape: Shape, origin: TransactionOrigin = this.localOrigin): void {
    this.doc.transact(() => {
      this.shapesMap.set(shape.id, shapeToYMap(shape));
    }, origin);
  }

  addMany(shapes: Shape[], origin: TransactionOrigin = this.localOrigin): void {
    this.doc.transact(() => {
      for (const s of shapes) this.shapesMap.set(s.id, shapeToYMap(s));
    }, origin);
  }

  update(id: ShapeId, patch: Partial<Shape>, origin: TransactionOrigin = this.localOrigin): void {
    this.doc.transact(() => {
      const yShape = this.shapesMap.get(id);
      if (!yShape) return; // deleted concurrently — normal in a CRDT, not an error
      for (const [k, v] of Object.entries(patch)) yShape.set(k, v);
      yShape.set('updatedAt', Date.now());
    }, origin);
  }

  updateMany(
    patches: Array<{ id: ShapeId; patch: Partial<Shape> }>,
    origin: TransactionOrigin = this.localOrigin,
  ): void {
    this.doc.transact(() => {
      const now = Date.now();
      for (const { id, patch } of patches) {
        const yShape = this.shapesMap.get(id);
        if (!yShape) continue;
        for (const [k, v] of Object.entries(patch)) yShape.set(k, v);
        yShape.set('updatedAt', now);
      }
    }, origin);
  }

  delete(ids: ShapeId[], origin: TransactionOrigin = this.localOrigin): void {
    this.doc.transact(() => {
      for (const id of ids) this.shapesMap.delete(id);
    }, origin);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  get(id: ShapeId): Shape | null {
    const yShape = this.shapesMap.get(id);
    return yShape ? yMapToShape(yShape) : null;
  }

  all(): Shape[] {
    return this.engine ? this.engine.allShapes() : [];
  }

  /** Next N fractional z-indices above everything currently on the board. */
  nextZ(count = 1): string[] {
    return zSequence(this.all(), count);
  }

  // -------------------------------------------------------------------------
  // Z-order
  // -------------------------------------------------------------------------

  bringToFront(ids: ShapeId[]): void {
    const zs = this.nextZ(ids.length);
    this.updateMany(ids.map((id, i) => ({ id, patch: { z: zs[i]! } as Partial<Shape> })));
  }

  sendToBack(ids: ShapeId[]): void {
    const sorted = [...this.all()].sort((a, b) => (a.z < b.z ? -1 : 1));
    const lowest = sorted[0]?.z ?? null;
    if (!lowest) return;
    // Prefix trick: any string sorting before the current lowest works as a fractional index,
    // and avoids renumbering every other shape.
    this.updateMany(
      ids.map((id, i) => ({
        id,
        patch: { z: `${'0'.repeat(i + 1)}${lowest}` } as Partial<Shape>,
      })),
    );
  }

  // -------------------------------------------------------------------------
  // Export / import — also the fastest debugging tool available
  // -------------------------------------------------------------------------

  toJSON(title: string) {
    return {
      version: 1 as const,
      title,
      exportedAt: Date.now(),
      shapes: this.all().sort((a, b) => (a.z < b.z ? -1 : 1)),
    };
  }

  loadJSON(shapes: Shape[]): void {
    this.doc.transact(() => {
      this.shapesMap.clear();
      for (const s of shapes) this.shapesMap.set(s.id, shapeToYMap(s));
    }, this.localOrigin);
  }

  /** Recompute index bounds for a shape without a document write (drag preview). */
  refreshBounds(shape: Shape): void {
    this.engine?.index.update(shape.id, shapeBounds(shape));
  }
}
