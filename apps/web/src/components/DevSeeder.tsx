import { useState } from 'react';
import { seedShapes, type Engine } from '@board/canvas-engine';

/**
 * Dev-only seeder. The verification harness for every performance claim in this project.
 *
 * Kept visible during the build rather than hidden behind a flag: a target you have to go
 * looking for is a target nobody measures. Gated out of production builds below.
 */
export function DevSeeder({ engine }: { engine: Engine | null }) {
  const [lastMs, setLastMs] = useState<number | null>(null);

  if (!engine || !import.meta.env.DEV) return null;

  const seed = (count: number) => {
    const t0 = performance.now();
    engine.setShapes(seedShapes({ count }));
    const bounds = engine.index.totalBounds();
    if (bounds) engine.camera.fitTo(bounds, engine.width, engine.height);
    engine.markDirty();
    setLastMs(performance.now() - t0);
  };

  const clear = () => {
    engine.setShapes([]);
    setLastMs(null);
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
          {n >= 1000 ? `${n / 1000}k` : n}
        </button>
      ))}
      <button
        onClick={clear}
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
