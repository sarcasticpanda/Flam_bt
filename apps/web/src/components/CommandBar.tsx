import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CornerDownLeft, Layers, Loader2, Sparkles, Wand2, Network, Lightbulb } from 'lucide-react';
import type { AIFeatureId } from '@board/shared';

export interface CommandDef {
  id: AIFeatureId;
  label: string;
  hint: string;
  /** Needs a typed prompt vs operating on the current selection. */
  needsPrompt: boolean;
  /** Minimum selected shapes required. */
  needsSelection: number;
  icon: React.ReactNode;
  example?: string;
}

const ICON = 17;
const STROKE = 1.75;

export const AI_COMMANDS: CommandDef[] = [
  {
    id: 'brainstorm',
    label: 'Brainstorm ideas',
    hint: 'Fans themed sticky notes onto the board',
    needsPrompt: true,
    needsSelection: 0,
    icon: <Lightbulb size={ICON} strokeWidth={STROKE} />,
    example: 'ways to reduce checkout drop-off',
  },
  {
    id: 'mindmap',
    label: 'Mind map',
    hint: 'Builds a radial tree from a topic',
    needsPrompt: true,
    needsSelection: 0,
    icon: <Network size={ICON} strokeWidth={STROKE} />,
    example: 'onboarding a new engineer',
  },
  {
    id: 'cluster',
    label: 'Group notes by theme',
    hint: 'Select sticky notes first — groups them into labelled frames',
    needsPrompt: false,
    needsSelection: 2,
    icon: <Layers size={ICON} strokeWidth={STROKE} />,
  },
  {
    id: 'cleanup',
    label: 'Clean up diagram',
    hint: 'Select rough shapes first — aligns them into a tidy layout',
    needsPrompt: false,
    needsSelection: 2,
    icon: <Wand2 size={ICON} strokeWidth={STROKE} />,
  },
];

export interface CommandBarState {
  open: boolean;
  busy: boolean;
  error: string | null;
  status: string | null;
}

/**
 * AI command bar (⌘K).
 *
 * A centred overlay rather than a docked panel: it is a momentary action, and stealing canvas
 * width permanently for something used a few times per session is the wrong trade.
 *
 * Commands that operate on a selection are disabled with the REASON shown inline, rather than
 * hidden — a command you can't find is worse than one you can't yet use.
 */
export function CommandBar({
  open,
  busy,
  error,
  status,
  selectionCount,
  onClose,
  onRun,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  status: string | null;
  selectionCount: number;
  onClose: () => void;
  onRun: (feature: AIFeatureId, prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const available = AI_COMMANDS.map((c) => ({
    ...c,
    disabled: c.needsSelection > 0 && selectionCount < c.needsSelection,
  }));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // Defer focus one frame: focusing during the same tick the overlay mounts loses it.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % available.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + available.length) % available.length);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, available.length]);

  if (!open) return null;

  const current = available[active];

  const submit = () => {
    if (!current || current.disabled || busy) return;
    if (current.needsPrompt && !query.trim()) {
      inputRef.current?.focus();
      return;
    }
    onRun(current.id, query.trim());
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[14vh]"
      style={{ background: 'rgba(0,0,0,.32)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="AI commands"
    >
      <div className="surface w-full max-w-xl overflow-hidden" style={{ borderRadius: 16 }}>
        <div
          className="flex items-center gap-2.5 px-4"
          style={{ height: 56, borderBottom: '1px solid var(--chrome-hairline)' }}
        >
          {busy ? (
            <Loader2 size={18} strokeWidth={2} className="animate-spin" style={{ color: 'var(--chrome-fg-dim)' }} />
          ) : (
            <Sparkles size={18} strokeWidth={1.75} style={{ color: 'var(--chrome-fg-dim)' }} />
          )}
          <input
            ref={inputRef}
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Stop canvas shortcuts from firing while typing a prompt.
              e.stopPropagation();
              if (e.key === 'Enter') submit();
            }}
            placeholder={
              current?.needsPrompt
                ? `e.g. ${current.example}`
                : `${current?.label ?? 'Pick a command'} — press Enter`
            }
            aria-label="AI prompt"
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{ color: 'var(--chrome-fg)', fontSize: 15 }}
          />
          <kbd
            className="rounded px-1.5 py-0.5"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--chrome-fg-dim)',
              border: '1px solid var(--chrome-hairline)',
            }}
          >
            ESC
          </kbd>
        </div>

        <ul className="max-h-[46vh] overflow-y-auto p-1.5" role="listbox">
          {available.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                role="option"
                aria-selected={i === active}
                disabled={cmd.disabled || busy}
                onPointerEnter={() => setActive(i)}
                onClick={() => {
                  setActive(i);
                  if (!cmd.disabled) onRun(cmd.id, query.trim());
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 text-left transition-colors disabled:cursor-not-allowed"
                style={{
                  minHeight: 48, // 44px+ touch target
                  background: i === active && !cmd.disabled ? 'var(--chrome-raised)' : 'transparent',
                  color: 'var(--chrome-fg)',
                  opacity: cmd.disabled ? 0.42 : 1,
                }}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
                  style={{ background: 'var(--chrome-raised)' }}
                >
                  {cmd.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block" style={{ fontSize: 14, fontWeight: 500 }}>
                    {cmd.label}
                  </span>
                  <span className="block truncate" style={{ fontSize: 12, color: 'var(--chrome-fg-dim)' }}>
                    {cmd.disabled
                      ? `Select ${cmd.needsSelection}+ shapes first (you have ${selectionCount})`
                      : cmd.hint}
                  </span>
                </span>
                {i === active && !cmd.disabled && (
                  <CornerDownLeft size={15} strokeWidth={1.75} style={{ color: 'var(--chrome-fg-dim)' }} />
                )}
              </button>
            </li>
          ))}
        </ul>

        {(error || status) && (
          <div
            className="flex items-start gap-2 px-4 py-2.5"
            style={{
              borderTop: '1px solid var(--chrome-hairline)',
              fontSize: 12,
              color: error ? 'var(--danger)' : 'var(--chrome-fg-dim)',
            }}
            role="status"
            aria-live="polite"
          >
            {error && <AlertCircle size={14} strokeWidth={2} className="mt-px shrink-0" />}
            <span>{error ?? status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
