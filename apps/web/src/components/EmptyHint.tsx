/**
 * Empty-board hint.
 *
 * Points explicitly AT the toolbar. The default tool is `select`, so a first-time user who
 * loads the board and immediately drags gets a selection marquee and concludes that drawing is
 * broken. Naming the two keys and pointing down fixes that in one glance.
 *
 * Disappears on the first shape and does not come back — a hint that keeps reappearing stops
 * being a hint and becomes furniture.
 */
export function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="flex max-w-md flex-col items-center px-6 text-center">
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
          <span style={{ opacity: 0.3 }}>———</span>
          BOARD
        </h1>

        <p
          className="mt-3"
          style={{ color: 'var(--canvas-ink)', opacity: 0.55, fontSize: 14, lineHeight: 1.55 }}
        >
          Pick a tool from the bar below to start drawing —<br />
          or press <Key>R</Key> for a box, <Key>P</Key> to draw freehand,
          <br />
          <Key>N</Key> for a sticky note.
        </p>

        {/* Points at the toolbar. The arrow is the whole reason this hint works. */}
        <svg
          width="26"
          height="86"
          viewBox="0 0 26 86"
          fill="none"
          className="mt-6"
          style={{ color: 'var(--canvas-ink)', opacity: 0.3 }}
          aria-hidden="true"
        >
          <path
            d="M13 2 C13 30, 5 44, 13 74"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M6 66 L13 78 L20 66"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        padding: '1px 6px',
        borderRadius: 4,
        border: '1px solid currentColor',
        opacity: 0.85,
      }}
    >
      {children}
    </kbd>
  );
}
