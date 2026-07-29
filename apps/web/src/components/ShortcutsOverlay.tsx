import { useEffect } from 'react';

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'], ['H', 'Pan'], ['P', 'Pen'], ['M', 'Highlighter'], ['E', 'Eraser'],
      ['R', 'Rectangle'], ['O', 'Ellipse'], ['L', 'Line'], ['A', 'Arrow'],
      ['T', 'Text'], ['N', 'Sticky note'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['⌘Z', 'Undo'], ['⌘⇧Z', 'Redo'], ['⌘D', 'Duplicate'], ['⌘C / ⌘V', 'Copy / paste'],
      ['⌘A', 'Select all'], ['Delete', 'Delete selection'],
      ['⌘]', 'Bring to front'], ['⌘[', 'Send to back'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Space + drag', 'Pan'], ['Middle drag', 'Pan'], ['⌘ + scroll', 'Zoom'],
      ['↑↓←→', 'Nudge 1px'], ['⇧ + arrows', 'Nudge 10px'],
      ['Esc', 'Cancel / deselect'],
    ],
  },
  {
    title: 'While drawing',
    items: [
      ['⇧', 'Constrain square / 45°'], ['⌥', 'Draw from centre'],
      ['Ctrl', 'Disable snapping'], ['Double-click', 'Edit text'],
    ],
  },
  {
    title: 'View',
    items: [['`', 'Performance HUD'], ['⇧T', 'Cycle theme'], ['?', 'This overlay']],
  },
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center p-6"
      style={{ background: 'rgba(0,0,0,.35)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="surface max-h-full w-full max-w-2xl overflow-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-baseline justify-between">
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.5rem',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Keyboard shortcuts
          </h2>
          <span style={{ color: 'var(--chrome-fg-dim)', fontSize: 12 }}>Press ? to close</span>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3
                className="mb-2"
                style={{
                  color: 'var(--chrome-fg-dim)',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {group.title}
              </h3>
              <dl className="space-y-1">
                {group.items.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <dt style={{ fontSize: 13 }}>{label}</dt>
                    <dd>
                      <kbd
                        className="rounded px-1.5 py-0.5"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          background: 'var(--chrome-raised)',
                          border: '1px solid var(--chrome-hairline)',
                        }}
                      >
                        {key}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
