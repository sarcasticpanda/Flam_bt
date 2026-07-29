import { useEffect, useRef, useState } from 'react';

/**
 * Colour picker: saturation/value square + hue slider + hex input.
 *
 * Hand-built rather than pulled from a package — it is ~120 lines, and a picker is exactly the
 * kind of component where a dependency's styling fights the theme system.
 *
 * `var(--canvas-ink)` is offered as a first-class choice, not a hex value. A shape stored with
 * the ink token adapts when the board is opened in another theme, which is the whole point of
 * the theme architecture.
 */
export function ColorPicker({
  value,
  onChange,
  allowInk = true,
  allowTransparent = false,
}: {
  value: string;
  onChange: (color: string) => void;
  allowInk?: boolean;
  allowTransparent?: boolean;
}) {
  const isToken = value.startsWith('var(');
  const [hsv, setHsv] = useState(() => hexToHsv(isToken ? '#14161A' : value));
  const [hex, setHex] = useState(isToken ? '' : value);
  const squareRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'sv' | 'hue' | null>(null);

  useEffect(() => {
    if (value.startsWith('var(') || value === 'transparent') return;
    setHex(value);
    setHsv(hexToHsv(value));
  }, [value]);

  const commit = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const nextHex = hsvToHex(next);
    setHex(nextHex);
    onChange(nextHex);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !squareRef.current) return;
      const rect = squareRef.current.getBoundingClientRect();
      if (dragging.current === 'sv') {
        const s = clamp01((e.clientX - rect.left) / rect.width);
        const v = 1 - clamp01((e.clientY - rect.top) / rect.height);
        commit({ ...hsv, s, v });
      }
    };
    const onUp = () => (dragging.current = null);
    // Listeners on window, not the element: the pointer routinely leaves the small square
    // mid-drag and the picker must keep tracking it.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [hsv]);

  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className="w-full">
      <div
        ref={squareRef}
        className="relative h-24 w-full cursor-crosshair rounded-md"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})`,
        }}
        onPointerDown={(e) => {
          dragging.current = 'sv';
          const rect = e.currentTarget.getBoundingClientRect();
          commit({
            ...hsv,
            s: clamp01((e.clientX - rect.left) / rect.width),
            v: 1 - clamp01((e.clientY - rect.top) / rect.height),
          });
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            boxShadow: '0 0 0 1px rgba(0,0,0,.5)',
          }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        onChange={(e) => commit({ ...hsv, h: Number(e.target.value) })}
        aria-label="Hue"
        className="mt-2 h-3 w-full cursor-pointer appearance-none rounded-full"
        style={{
          background:
            'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)',
        }}
      />

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="h-6 w-6 shrink-0 rounded-md"
          style={{ background: hex || '#000', border: '1px solid var(--chrome-hairline)' }}
        />
        <input
          value={hex}
          onChange={(e) => {
            const next = e.target.value;
            setHex(next);
            // Only propagate a COMPLETE hex, or every keystroke mid-typing repaints the shape.
            if (/^#[0-9a-fA-F]{6}$/.test(next)) {
              setHsv(hexToHsv(next));
              onChange(next);
            }
          }}
          spellCheck={false}
          aria-label="Hex colour"
          className="min-w-0 flex-1 rounded-md px-2 py-1 outline-none"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            background: 'var(--chrome-raised)',
            color: 'var(--chrome-fg)',
            border: '1px solid var(--chrome-hairline)',
          }}
        />
      </div>

      {(allowInk || allowTransparent) && (
        <div className="mt-2 flex gap-1">
          {allowInk && (
            <button
              onClick={() => onChange('var(--canvas-ink)')}
              className="flex-1 rounded-md py-1 text-[11px] transition-colors"
              style={{
                background: isToken ? 'var(--chrome-fg)' : 'var(--chrome-raised)',
                color: isToken ? 'var(--chrome-bg)' : 'var(--chrome-fg)',
              }}
              title="Adapts to the active theme"
            >
              Ink
            </button>
          )}
          {allowTransparent && (
            <button
              onClick={() => onChange('transparent')}
              className="flex-1 rounded-md py-1 text-[11px] transition-colors"
              style={{
                background: value === 'transparent' ? 'var(--chrome-fg)' : 'var(--chrome-raised)',
                color: value === 'transparent' ? 'var(--chrome-bg)' : 'var(--chrome-fg)',
              }}
            >
              None
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, v: 0.1 };
  const int = parseInt(m[1]!, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex({ h, s, v }: { h: number; s: number; v: number }): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const to255 = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to255(rgb[0])}${to255(rgb[1])}${to255(rgb[2])}`;
}
