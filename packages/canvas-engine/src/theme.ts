/**
 * Canvas 2D cannot resolve CSS custom properties — `ctx.strokeStyle = 'var(--canvas-ink)'`
 * silently does nothing and the shape renders in the previous colour.
 *
 * Shapes still STORE `var(--canvas-ink)` so that a shape drawn in Paper theme adapts when the
 * board is opened in Ink theme. The engine resolves those tokens to concrete colours once per
 * theme change, not per shape per frame.
 */
export interface ThemeColors {
  canvasBg: string;
  canvasInk: string;
  canvasGrid: string;
  chromeFg: string;
  chromeFgDim: string;
  selection: string;
}

export const DEFAULT_THEME: ThemeColors = {
  canvasBg: '#FBFAF7',
  canvasInk: '#14161A',
  canvasGrid: '#D8D5CD',
  chromeFg: '#FBFAF7',
  chromeFgDim: '#8A909E',
  selection: '#14161A',
};

const TOKEN_MAP: Record<string, keyof ThemeColors> = {
  '--canvas-bg': 'canvasBg',
  '--canvas-ink': 'canvasInk',
  '--canvas-grid': 'canvasGrid',
  '--chrome-fg': 'chromeFg',
  '--chrome-fg-dim': 'chromeFgDim',
};

/**
 * Resolve a stored colour to something Canvas 2D accepts.
 *
 * Anything that is not a recognised token passes through untouched — user-chosen sticky and
 * fill colours are plain hex and must not be rewritten by the theme.
 */
export function resolveColor(value: string, theme: ThemeColors): string {
  if (!value.startsWith('var(')) return value;
  const token = value.slice(4, -1).trim();
  const key = TOKEN_MAP[token];
  return key ? theme[key] : theme.canvasInk;
}

/** Read the active theme out of the DOM once, after a theme switch. */
export function readThemeFromDOM(el: HTMLElement): ThemeColors {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    canvasBg: get('--canvas-bg', DEFAULT_THEME.canvasBg),
    canvasInk: get('--canvas-ink', DEFAULT_THEME.canvasInk),
    canvasGrid: get('--canvas-grid', DEFAULT_THEME.canvasGrid),
    chromeFg: get('--chrome-fg', DEFAULT_THEME.chromeFg),
    chromeFgDim: get('--chrome-fg-dim', DEFAULT_THEME.chromeFgDim),
    selection: get('--canvas-ink', DEFAULT_THEME.canvasInk),
  };
}
