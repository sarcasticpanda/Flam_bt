import { useEffect, useState } from 'react';
import type { Engine, EngineStats } from '@board/canvas-engine';

/**
 * Dev perf HUD. Part of the deliverable, not a debug leftover.
 *
 * It turns "handles 10,000 shapes" from an assertion into a measurement anyone can watch live —
 * which is the fastest way to prove the claim in a demo, and the fastest way to catch a
 * regression during the build.
 *
 * Polls at 5Hz rather than subscribing per frame: this is chrome, and re-rendering React 60
 * times a second to display a frame counter would be its own performance bug.
 */
export function PerfHUD({ engine, visible }: { engine: Engine | null; visible: boolean }) {
  const [stats, setStats] = useState<EngineStats | null>(null);

  useEffect(() => {
    if (!engine || !visible) return;
    const id = setInterval(() => setStats({ ...engine.stats }), 200);
    return () => clearInterval(id);
  }, [engine, visible]);

  if (!visible || !stats) return null;

  const fpsColor =
    stats.idle ? 'var(--chrome-fg-dim)' : stats.fps >= 55 ? 'var(--success)' : stats.fps >= 30 ? '#C9A227' : 'var(--danger)';

  return (
    <div
      className="surface pointer-events-none px-3 py-2.5"
      style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.65, minWidth: 172 }}
    >
      <Row label="fps" value={stats.idle ? 'idle' : String(stats.fps)} color={fpsColor} />
      <Row label="frame" value={`${stats.msFrame.toFixed(2)}ms`} />
      <Row label="cull" value={`${stats.msCull.toFixed(2)}ms`} />
      <Row label="draw" value={`${stats.msDraw.toFixed(2)}ms`} />
      <div className="my-1.5 h-px" style={{ background: 'var(--chrome-hairline)' }} />
      <Row label="shapes" value={stats.total.toLocaleString()} />
      <Row label="visible" value={stats.visible.toLocaleString()} />
      <Row
        label="culled"
        value={`${stats.culledPct.toFixed(1)}%`}
        color={stats.culledPct > 50 ? 'var(--success)' : undefined}
      />
      <Row label="cells" value={String(stats.cells)} />
      <Row label="zoom" value={`${Math.round(engine!.camera.zoom * 100)}%`} />
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span style={{ color: 'var(--chrome-fg-dim)' }}>{label}</span>
      <span style={{ color: color ?? 'var(--chrome-fg)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}
