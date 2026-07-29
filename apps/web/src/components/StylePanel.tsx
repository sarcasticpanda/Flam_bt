import { STICKY_COLORS, STROKE_WIDTHS, type DashStyle } from '@board/shared';
import type { StyleDefaults } from '../canvas/tools/types';

/**
 * Contextual style panel, left-centre.
 *
 * Always visible, not only on selection: with nothing selected it sets the DEFAULT for the next
 * shape drawn. That is the behaviour people expect from a drawing tool and immediately notice
 * when it is missing — the header line makes which mode you are in explicit.
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
  return (
    <div className="surface absolute top-1/2 left-4 z-40 w-[188px] -translate-y-1/2 p-3">
      <div
        className="mb-2.5 leading-snug"
        style={{ color: 'var(--chrome-fg-dim)', fontSize: 11 }}
      >
        {selectionCount > 0
          ? `Styling ${selectionCount} selected`
          : 'Sets the style for the next shape'}
      </div>

      <Section label="Stroke">
        <div className="flex gap-1.5">
          <Swatch
            color="var(--canvas-ink)"
            active={style.stroke === 'var(--canvas-ink)'}
            onClick={() => onChange({ stroke: 'var(--canvas-ink)' })}
            title="Ink"
          />
          {['#C4442E', '#2F7D5C', '#3D7EA6', '#C9A227'].map((c) => (
            <Swatch
              key={c}
              color={c}
              active={style.stroke === c}
              onClick={() => onChange({ stroke: c })}
              title={c}
            />
          ))}
        </div>
      </Section>

      <Section label="Fill">
        <div className="flex gap-1.5">
          <Swatch
            color="transparent"
            active={style.fill === 'transparent'}
            onClick={() => onChange({ fill: 'transparent' })}
            title="No fill"
            showNone
          />
          {['#00000012', '#FBE39A', '#B7D9F2', '#B6E3C6', '#F5A7A7'].map((c) => (
            <Swatch
              key={c}
              color={c}
              active={style.fill === c}
              onClick={() => onChange({ fill: c })}
              title={c}
            />
          ))}
        </div>
      </Section>

      <Section label="Width">
        <div className="flex items-center gap-1">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => onChange({ strokeWidth: w })}
              title={`${w}px`}
              aria-label={`Stroke width ${w}`}
              aria-pressed={style.strokeWidth === w}
              className="grid h-8 flex-1 place-items-center rounded-md transition-colors"
              style={{
                background: style.strokeWidth === w ? 'var(--chrome-raised)' : 'transparent',
              }}
            >
              <span
                className="block w-5 rounded-full"
                style={{ height: Math.min(w, 8), background: 'var(--chrome-fg)' }}
              />
            </button>
          ))}
        </div>
      </Section>

      <Section label="Dash">
        <div className="flex gap-1">
          {(['solid', 'dashed', 'dotted'] as DashStyle[]).map((d) => (
            <button
              key={d}
              onClick={() => onChange({ dash: d })}
              aria-pressed={style.dash === d}
              className="h-8 flex-1 rounded-md text-[11px] capitalize transition-colors"
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

      <Section label="Sticky colour">
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
          className="w-full accent-current"
          style={{ color: 'var(--chrome-fg)' }}
        />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div
        className="mb-1.5"
        style={{ color: 'var(--chrome-fg-dim)', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Swatch({
  color,
  active,
  onClick,
  title,
  showNone,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
  title: string;
  showNone?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="relative h-6 w-6 rounded-md transition-transform hover:scale-110"
      style={{
        background: color === 'transparent' ? 'transparent' : color,
        border: '1px solid var(--chrome-hairline)',
        outline: active ? '2px solid var(--chrome-fg)' : 'none',
        outlineOffset: 1,
      }}
    >
      {showNone && (
        <span
          className="absolute inset-0 m-auto block h-[1px] w-[18px] origin-center rotate-45"
          style={{ background: 'var(--chrome-fg-dim)' }}
        />
      )}
    </button>
  );
}
