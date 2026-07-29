/**
 * Empty-board hint.
 *
 * Disappears on the first shape and does not come back — a hint that keeps reappearing stops
 * being a hint and becomes furniture.
 */
export function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="max-w-md px-6 text-center">
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.75rem',
            lineHeight: 1.02,
            fontWeight: 600,
            letterSpacing: '-0.03em',
            color: 'var(--canvas-ink)',
            opacity: 0.9,
          }}
        >
          THE
          <span style={{ opacity: 0.35 }}>———</span>
          BOARD
        </h1>
        <p
          className="mt-3"
          style={{ color: 'var(--canvas-ink)', opacity: 0.5, fontSize: 14, lineHeight: 1.5 }}
        >
          Pick a tool below to start drawing.
          <br />
          Press{' '}
          <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>?</kbd> for shortcuts.
        </p>
      </div>
    </div>
  );
}
