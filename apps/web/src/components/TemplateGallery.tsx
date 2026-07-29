import { useEffect } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import { TEMPLATES, type TemplateDef } from '../features/templates/templates';

/**
 * Template gallery.
 *
 * Each card previews the template's actual geometry as inline SVG rather than a bitmap, so the
 * preview is always in sync with what the template builds and adapts to the active theme for
 * free. A screenshot preview would drift the moment a template changed.
 */
export function TemplateGallery({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (t: TemplateDef) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center p-6"
      style={{ background: 'rgba(0,0,0,.35)' }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Templates"
    >
      <div className="surface w-full max-w-3xl overflow-hidden" style={{ borderRadius: 16 }}>
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid var(--chrome-hairline)' }}
        >
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Start from a template</h2>
            <p style={{ fontSize: 12, color: 'var(--chrome-fg-dim)', marginTop: 2 }}>
              Dropped into free space — everything stays fully editable.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close templates"
            className="grid place-items-center rounded-md transition-colors hover:bg-[var(--chrome-raised)]"
            style={{ height: 36, width: 36, color: 'var(--chrome-fg)' }}
          >
            <X size={17} strokeWidth={1.75} />
          </button>
        </div>

        <div className="grid max-h-[60vh] gap-2 overflow-y-auto p-4 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onInsert(t)}
              className="group flex flex-col gap-2 rounded-xl p-3 text-left transition-colors hover:bg-[var(--chrome-raised)]"
              style={{ border: '1px solid var(--chrome-hairline)', minHeight: 140 }}
            >
              <span
                className="grid h-20 w-full place-items-center overflow-hidden rounded-lg"
                style={{ background: 'var(--chrome-raised)' }}
              >
                <Preview id={t.id} />
              </span>
              <span>
                <span className="block" style={{ fontSize: 13, fontWeight: 500, color: 'var(--chrome-fg)' }}>
                  {t.name}
                </span>
                <span className="block" style={{ fontSize: 11, color: 'var(--chrome-fg-dim)' }}>
                  {t.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Inline SVG thumbnails — theme-aware and always in sync with the real template. */
function Preview({ id }: { id: string }) {
  const s = { stroke: 'var(--chrome-fg)', strokeWidth: 1.4, fill: 'none' } as const;
  const dim = 'var(--chrome-fg-dim)';

  switch (id) {
    case 'flowchart':
      return (
        <svg width="72" height="60" viewBox="0 0 72 60" aria-hidden="true">
          <rect x="26" y="2" width="20" height="9" rx="4.5" {...s} />
          <rect x="26" y="19" width="20" height="10" {...s} />
          <path d="M36 11v8M36 29v6M36 46v6" stroke={dim} strokeWidth="1.2" />
          <path d="M36 35l7 6-7 6-7-6z" {...s} />
          <rect x="26" y="52" width="20" height="7" rx="3.5" {...s} />
        </svg>
      );
    case 'mindmap':
      return (
        <svg width="76" height="56" viewBox="0 0 76 56" aria-hidden="true">
          <rect x="27" y="22" width="22" height="12" rx="6" {...s} />
          <path d="M27 28H10M49 28h17M38 22V8M38 34v14" stroke={dim} strokeWidth="1.2" />
          <rect x="0" y="23" width="10" height="9" rx="4" {...s} />
          <rect x="66" y="23" width="10" height="9" rx="4" {...s} />
          <rect x="30" y="0" width="16" height="8" rx="4" {...s} />
          <rect x="30" y="48" width="16" height="8" rx="4" {...s} />
        </svg>
      );
    case 'kanban':
      return (
        <svg width="72" height="56" viewBox="0 0 72 56" aria-hidden="true">
          {[0, 25, 50].map((x) => (
            <g key={x}>
              <rect x={x} y="0" width="20" height="56" rx="2" stroke={dim} strokeWidth="1" fill="none" />
              <rect x={x + 3} y="5" width="14" height="11" rx="2" {...s} />
              <rect x={x + 3} y="21" width="14" height="11" rx="2" {...s} />
            </g>
          ))}
        </svg>
      );
    case 'swot':
      return (
        <svg width="64" height="56" viewBox="0 0 64 56" aria-hidden="true">
          <rect x="0" y="0" width="30" height="26" rx="2" {...s} />
          <rect x="34" y="0" width="30" height="26" rx="2" {...s} />
          <rect x="0" y="30" width="30" height="26" rx="2" {...s} />
          <rect x="34" y="30" width="30" height="26" rx="2" {...s} />
        </svg>
      );
    case 'retro':
      return (
        <svg width="72" height="56" viewBox="0 0 72 56" aria-hidden="true">
          {[0, 25, 50].map((x) => (
            <g key={x}>
              <path d={`M${x} 4h16`} stroke={dim} strokeWidth="1.6" />
              <rect x={x} y="10" width="20" height="18" rx="2" {...s} />
              <rect x={x} y="32" width="20" height="18" rx="2" {...s} />
            </g>
          ))}
        </svg>
      );
    default:
      return <LayoutTemplate size={26} strokeWidth={1.5} style={{ color: dim }} aria-hidden="true" />;
  }
}
