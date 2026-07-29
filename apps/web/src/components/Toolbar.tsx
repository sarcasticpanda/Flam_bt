import {
  ArrowUpRight, Circle, Eraser, Hand, Highlighter, Minus,
  MousePointer2, PaintBucket, Pen, Pipette, Square, StickyNote, Type,
} from 'lucide-react';
import type { ToolId } from '../canvas/tools/types';

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: React.ReactNode;
}

const SIZE = 19;
const STROKE = 1.75;

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={SIZE} strokeWidth={STROKE} /> },
  { id: 'hand', label: 'Pan', key: 'H', icon: <Hand size={SIZE} strokeWidth={STROKE} /> },
  { id: 'pen', label: 'Pen', key: 'P', icon: <Pen size={SIZE} strokeWidth={STROKE} /> },
  { id: 'highlighter', label: 'Highlighter', key: 'M', icon: <Highlighter size={SIZE} strokeWidth={STROKE} /> },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser size={SIZE} strokeWidth={STROKE} /> },
  { id: 'fill', label: 'Fill', key: 'G', icon: <PaintBucket size={SIZE} strokeWidth={STROKE} /> },
  { id: 'eyedropper', label: 'Pick colour', key: 'I', icon: <Pipette size={SIZE} strokeWidth={STROKE} /> },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={SIZE} strokeWidth={STROKE} /> },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: <Circle size={SIZE} strokeWidth={STROKE} /> },
  { id: 'line', label: 'Line', key: 'L', icon: <Minus size={SIZE} strokeWidth={STROKE} /> },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: <ArrowUpRight size={SIZE} strokeWidth={STROKE} /> },
  { id: 'text', label: 'Text', key: 'T', icon: <Type size={SIZE} strokeWidth={STROKE} /> },
  { id: 'sticky', label: 'Sticky note', key: 'N', icon: <StickyNote size={SIZE} strokeWidth={STROKE} /> },
];

/**
 * A single horizontal ink pill, bottom-centre.
 *
 * The active tool is an INVERSION — paper-filled well with an ink icon — not a colour change.
 * That keeps the signature rule intact (no chroma in chrome) and, usefully, means it works in
 * all five themes without a single special case.
 */
export function Toolbar({
  active,
  onSelect,
}: {
  active: ToolId;
  onSelect: (id: ToolId) => void;
}) {
  const activeDef = TOOLS.find((t) => t.id === active);

  return (
    <div
      className="surface absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 p-1.5"
      role="toolbar"
      aria-label="Drawing tools"
    >
      {/* Always name the active tool. Icon-only toolbars leave people unsure what mode they are
          in, and "why can't I draw?" is almost always "you're still on Select". */}
      <span
        className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded px-2 py-0.5 whitespace-nowrap"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--chrome-fg-dim)',
          background: 'color-mix(in srgb, var(--chrome-bg) 88%, transparent)',
        }}
      >
        {activeDef?.label ?? active} · {activeDef?.key}
      </span>

      {TOOLS.map((tool, i) => (
        <div key={tool.id} className="flex items-center">
          {/* Separators between navigation, paint, and shape groups. */}
          {(i === 2 || i === 7) && (
            <div className="mx-1 h-6 w-px" style={{ background: 'var(--chrome-hairline)' }} />
          )}
          <button
            onClick={() => onSelect(tool.id)}
            aria-label={`${tool.label} (${tool.key})`}
            aria-pressed={active === tool.id}
            title={`${tool.label}  ${tool.key}`}
            className="group relative grid h-10 w-10 place-items-center rounded-lg transition-colors"
            style={
              active === tool.id
                ? { background: 'var(--chrome-fg)', color: 'var(--chrome-bg)' }
                : { color: 'var(--chrome-fg)' }
            }
            onMouseEnter={(e) => {
              if (active !== tool.id) e.currentTarget.style.background = 'var(--chrome-raised)';
            }}
            onMouseLeave={(e) => {
              if (active !== tool.id) e.currentTarget.style.background = 'transparent';
            }}
          >
            {tool.icon}
          </button>
        </div>
      ))}
    </div>
  );
}
