import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { THEMES, type ThemeName } from '@board/shared';

const LABELS: Record<ThemeName, string> = {
  paper: 'Paper',
  ink: 'Ink',
  slate: 'Slate',
  blueprint: 'Blueprint',
  contrast: 'High contrast',
};

const DESCRIPTIONS: Record<ThemeName, string> = {
  paper: 'Warm board, dark instruments',
  ink: 'Dark board, light instruments',
  slate: 'Cool dark, sharper edges',
  blueprint: 'Drafting table, cyan grid',
  contrast: 'Maximum legibility',
};

/**
 * Theme switcher.
 *
 * Every theme changes the neutral ramp ONLY — the 12 participant hues are invariant, so a
 * collaborator's cursor colour never shifts when you change your own theme. The swatches below
 * preview canvas + chrome + one participant colour, which is exactly the trio that has to stay
 * legible together.
 */
export function ThemeMenu({
  theme,
  onChange,
}: {
  theme: ThemeName;
  onChange: (t: ThemeName) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-expanded={open}
        title="Change theme (T)"
        className="surface grid h-10 w-10 place-items-center transition-colors hover:bg-[var(--chrome-raised)]"
      >
        <Palette size={18} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="surface absolute top-12 right-0 w-64 overflow-hidden p-1.5">
          <div
            className="px-2.5 pt-1.5 pb-2"
            style={{ color: 'var(--chrome-fg-dim)', fontSize: 11, letterSpacing: '0.02em' }}
          >
            Theme changes the interface only. Participant colours stay the same.
          </div>
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--chrome-raised)]"
              style={{ color: 'var(--chrome-fg)' }}
            >
              <Swatch theme={t} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-tight font-medium">{LABELS[t]}</span>
                <span
                  className="block truncate text-[11px] leading-tight"
                  style={{ color: 'var(--chrome-fg-dim)' }}
                >
                  {DESCRIPTIONS[t]}
                </span>
              </span>
              {theme === t && <Check size={15} strokeWidth={2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Canvas + chrome + one participant colour — the trio a theme has to keep legible together. */
function Swatch({ theme }: { theme: ThemeName }) {
  const preview: Record<ThemeName, [string, string, string]> = {
    paper: ['#FBFAF7', '#14161A', 'oklch(52% 0.15 12)'],
    ink: ['#16181C', '#F2F0EB', 'oklch(72% 0.13 12)'],
    slate: ['#1A1D23', '#FFFFFF', 'oklch(75% 0.14 12)'],
    blueprint: ['#0C1A2B', '#DCEBF7', 'oklch(74% 0.15 12)'],
    contrast: ['#FFFFFF', '#000000', 'oklch(62% 0.19 12)'],
  };
  const [bg, fg, participant] = preview[theme];
  return (
    <span
      className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md"
      style={{ background: bg, border: '1px solid var(--chrome-hairline)' }}
    >
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: fg }} />
      <span
        className="absolute right-0.5 bottom-0.5 h-2 w-2 rounded-full"
        style={{ background: participant }}
      />
    </span>
  );
}
