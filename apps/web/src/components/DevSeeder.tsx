import { useState } from 'react';
import { seedShapes, type Engine } from '@board/canvas-engine';
import type { BoardDoc } from '../collab/BoardDoc';

/**
 * Dev-only seeder — the verification harness for every performance claim in this project.
 *
 * Seeds through the DOCUMENT rather than straight into the engine, so seeded shapes behave
 * exactly like drawn ones: undoable, exportable, and (from Block C) synced to peers. A seeder
 * that bypasses the document tests a code path that does not exist in production.
 */
export function DevSeeder({ engine, doc }: { engine: Engine | null; doc: BoardDoc | null }) {
  const [lastMs, setLastMs] = useState<number | null>(null);

  if (!engine || !doc || !import.meta.env.DEV) return null;

  const seed = (count: number) => {
    const t0 = performance.now();
    doc.loadJSON(seedShapes({ count }));
    const bounds = engine.index.totalBounds();
    if (bounds) engine.camera.fitTo(bounds, engine.width, engine.height);
    engine.markDirty();
    setLastMs(performance.now() - t0);
  };

  return (
    <div className="surface absolute right-4 bottom-4 z-40 flex items-center gap-1 p-1">
      <span
        className="px-2"
        style={{ color: 'var(--chrome-fg-dim)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
      >
        SEED
      </span>
      {[1_000, 10_000, 50_000].map((n) => (
        <button
          key={n}
          onClick={() => seed(n)}
          className="h-7 rounded-md px-2.5 transition-colors hover:bg-[var(--chrome-raised)]"
          style={{ color: 'var(--chrome-fg)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          {n / 1000}k
        </button>
      ))}
      <button
        onClick={() => {
          doc.loadJSON([]);
          setLastMs(null);
        }}
        className="h-7 rounded-md px-2.5 transition-colors hover:bg-[var(--chrome-raised)]"
        style={{ color: 'var(--chrome-fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
      >
        clear
      </button>
      {lastMs !== null && (
        <span
          className="px-2"
          style={{ color: 'var(--chrome-fg-dim)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
        >
          {lastMs.toFixed(0)}ms
        </span>
      )}
    </div>
  );
}
