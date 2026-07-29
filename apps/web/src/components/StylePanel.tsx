import { useState } from 'react';
import { STICKY_COLORS, type BrushKind, type DashStyle } from '@board/shared';
import type { StyleDefaults } from '../canvas/tools/types';
import { ColorPicker } from './ColorPicker';

const BRUSHES: Array<{ id: BrushKind; label: string; hint: string }> = [
  { id: 'brush', label: 'Brush', hint: 'Pressure-sensitive, tapers at both ends' },
  { id: 'pen', label: 'Pen', hint: 'Constant width, smooth' },
  { id: 'marker', label: 'Marker', hint: 'Thick, flat ends' },
  { id: 'pencil', label: 'Pencil', hint: 'Textured, lighter' },
];

const RECENT_KEY = 'board:recentColors';

/**
 * Style panel, left-centre.
 *
 * Always visible rather than selection-only: with nothing selected it sets the DEFAULT for the
 * next shape, which is the behaviour people expect from a paint tool and immediately notice
 * when it is missing. The header line makes which mode you are in explicit.
 */
export function StylePanel({
  style,
  selectionCount,
  onChange,
}: {
  style: StyleDefaults;
  selectionCount: number;
  onChange: (patch: Partial<StyleDefaults>) => void;
}) {
  const [target, setTarget] = useState<'stroke' | 'fill'>('stroke');
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  });

  const pushRecent = (color: string) => {
    if (color.startsWith('var(') || color === 'transparent') return;
    setRecents((prev) => {
      const next = [color, ...prev.filter((c) => c !== color)].slice(0, 10);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* private mode — recents are a convenience, not state worth failing over */
      }
      return next;
    });
  };

  const setColor = (color: string) => {
    onChange(target === 'stroke' ? { stroke: color } : { fill: color });
    pushRecent(color);
  };

  return (
    <div
      className="surface absolute left-4 z-40 w-[204px] overflow-y-auto p-3"
      // Anchored between top and bottom insets rather than vertically centered with a fixed
      // max-height: centering let this panel's scrollable content grow tall enough to reach
      // down into the bottom-left corner stack (perf HUD + zoom + call button) and visually
      // overlap it on anything shorter than a very tall viewport. Setting both `top` and
      // `bottom` on an absolutely positioned element makes the browser derive its height from
      // the space actually available, so it can never encroach on the reserved corner region.
      //
      // 340px covers the corner stack's worst case (HUD open + zoom controls + call join
      // buttons, measured at ~317px) plus a margin — verified against the live layout, not
      // guessed, since an under-estimate here silently reintroduces the same overlap it fixes.
      style={{ top: 84, bottom: 340 }}
    >
      <div className="mb-2.5 leading-snug" style={{ color: 'var(--chrome-fg-dim)', fontSize: 11 }}>
        {selectionCount > 0
          ? `Styling ${selectionCount} selected`
          : 'Sets the style for the next shape'}
      </div>

      {/* Which colour the picker edits. */}
      <div className="mb-2 flex gap-1">
        {(['stroke', 'fill'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTarget(t)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] capitalize transition-colors"
            style={{
              background: target === t ? 'var(--chrome-raised)' : 'transparent',
              color: 'var(--chrome-fg)',
            }}
          >
            <span
              className="h-3 w-3 rounded-sm"
              style={{
                background:
                  (t === 'stroke' ? style.stroke : style.fill) === 'transparent'
                    ? 'repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 50% / 6px 6px'
                    : (t === 'stroke' ? style.stroke : style.fill).startsWith('var(')
                      ? 'var(--chrome-fg)'
                      : t === 'stroke'
                        ? style.stroke
                        : style.fill,
                border: '1px solid var(--chrome-hairline)',
              }}
            />
            {t}
          </button>
        ))}
      </div>

      <ColorPicker
        value={target === 'stroke' ? style.stroke : style.fill}
        onChange={setColor}
        allowInk={target === 'stroke'}
        allowTransparent={target === 'fill'}
      />

      {recents.length > 0 && (
        <Section label="Recent">
          <div className="flex flex-wrap gap-1">
            {recents.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                aria-label={`Recent colour ${c}`}
                className="h-5 w-5 rounded-sm transition-transform hover:scale-110"
                style={{ background: c, border: '1px solid var(--chrome-hairline)' }}
              />
            ))}
          </div>
        </Section>
      )}

      <Section label="Brush">
        <div className="grid grid-cols-2 gap-1">
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              onClick={() => onChange({ brush: b.id })}
              title={b.hint}
              aria-pressed={style.brush === b.id}
              className="rounded-md py-1.5 text-[11px] transition-colors"
              style={{
                background: style.brush === b.id ? 'var(--chrome-fg)' : 'var(--chrome-raised)',
                color: style.brush === b.id ? 'var(--chrome-bg)' : 'var(--chrome-fg)',
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </Section>

      <Section label={`Size ${style.strokeWidth}px`}>
        <input
          type="range"
          min={1}
          max={64}
          value={style.strokeWidth}
          onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
          aria-label="Brush size"
          className="w-full"
          style={{ accentColor: 'var(--chrome-fg)' }}
        />
        {/* Live preview dot — a number alone does not tell you how fat 28px actually is. */}
        <div className="mt-1 flex h-8 items-center justify-center rounded-md" style={{ background: 'var(--chrome-raised)' }}>
          <span
            className="rounded-full"
            style={{
              width: Math.min(style.strokeWidth, 30),
              height: Math.min(style.strokeWidth, 30),
              background: style.stroke.startsWith('var(') ? 'var(--chrome-fg)' : style.stroke,
            }}
          />
        </div>
      </Section>

      <Section label="Dash">
        <div className="flex gap-1">
          {(['solid', 'dashed', 'dotted'] as DashStyle[]).map((d) => (
            <button
              key={d}
              onClick={() => onChange({ dash: d })}
              aria-pressed={style.dash === d}
              className="h-7 flex-1 rounded-md text-[10px] capitalize transition-colors"
              style={{
                background: style.dash === d ? 'var(--chrome-raised)' : 'transparent',
                color: 'var(--chrome-fg)',
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Sticky note">
        <div className="grid grid-cols-8 gap-1">
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ stickyColor: c })}
              title={c}
              aria-label={`Sticky colour ${c}`}
              aria-pressed={style.stickyColor === c}
              className="h-5 rounded-sm transition-transform hover:scale-110"
              style={{
                background: c,
                outline: style.stickyColor === c ? '2px solid var(--chrome-fg)' : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
      </Section>

      <Section label={`Opacity ${Math.round(style.opacity * 100)}%`}>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(style.opacity * 100)}
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          aria-label="Opacity"
          className="w-full"
          style={{ accentColor: 'var(--chrome-fg)' }}
        />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div
        className="mb-1.5"
        style={{
          color: 'var(--chrome-fg-dim)',
          fontSize: 10,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
