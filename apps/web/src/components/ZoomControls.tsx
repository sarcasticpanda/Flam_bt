import { useEffect, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { Engine } from '@board/canvas-engine';

/**
 * Zoom cluster. Positioning is owned by BottomLeftStack, which measures every sibling's real
 * height and stacks them without collision — this component only renders its own content.
 */
export function ZoomControls({ engine }: { engine: Engine | null }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => setZoom(engine.camera.zoom), 150);
    return () => clearInterval(id);
  }, [engine]);

  if (!engine) return null;

  const zoomBy = (factor: number) => {
    engine.camera.zoomAt(engine.width / 2, engine.height / 2, factor);
    engine.markDirty();
    engine.markOverlayDirty();
  };

  const reset = () => {
    engine.camera.zoom = 1;
    engine.markDirty();
    engine.markOverlayDirty();
  };

  const fit = () => {
    const bounds = engine.index.totalBounds();
    if (!bounds) return reset();
    engine.camera.fitTo(bounds, engine.width, engine.height);
    engine.markDirty();
    engine.markOverlayDirty();
  };

  return (
    <div className="surface flex items-center gap-0.5 p-1">
      <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
        <Minus size={16} strokeWidth={1.75} />
      </IconButton>

      <button
        onClick={reset}
        title="Reset to 100%"
        className="h-8 min-w-[58px] rounded-md px-2 text-center transition-colors hover:bg-[var(--chrome-raised)]"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--chrome-fg)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {Math.round(zoom * 100)}%
      </button>

      <IconButton label="Zoom in" onClick={() => zoomBy(1.2)}>
        <Plus size={16} strokeWidth={1.75} />
      </IconButton>

      <div className="mx-0.5 h-5 w-px" style={{ background: 'var(--chrome-hairline)' }} />

      <IconButton label="Zoom to fit" onClick={fit}>
        <Maximize2 size={15} strokeWidth={1.75} />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--chrome-raised)]"
      style={{ color: 'var(--chrome-fg)' }}
    >
      {children}
    </button>
  );
}
