import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Plus, Trash2 } from 'lucide-react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@board/shared';
import { ApiError, api, forgetBoard, getRecentBoards, type RecentBoard } from '../lib/api';

/**
 * Landing: create a board, join one by code, or reopen a recent one.
 *
 * No signup. A reviewer with the link should be drawing within a couple of seconds — auth would
 * make the demo strictly worse, and it is the documented next step rather than an oversight.
 */
export function Landing({ onOpen }: { onOpen: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<RecentBoard[]>([]);

  useEffect(() => setRecents(getRecentBoards()), []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const board = await api.createBoard('Untitled board');
      onOpen(board.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a board.');
      setBusy(false);
    }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== ROOM_CODE_LENGTH) {
      setError(`A board code is ${ROOM_CODE_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.getBoard(clean);
      onOpen(clean);
    } catch (err) {
      // Inline error on the landing page, never a 404 route — you should be able to fix a typo
      // without losing the page you are on.
      setError(
        err instanceof ApiError && err.status === 404
          ? `No board with the code ${clean}.`
          : 'Could not reach the server.',
      );
      setBusy(false);
    }
  };

  return (
    <div
      className="h-full w-full overflow-y-auto"
      style={{ background: 'var(--canvas-bg)', color: 'var(--canvas-ink)' }}
    >
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-6 py-16">
        <header>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2.5rem, 7vw, 3.25rem)',
              lineHeight: 1.02,
              fontWeight: 600,
              letterSpacing: '-0.03em',
            }}
          >
            THE<span style={{ opacity: 0.3 }}>———</span>BOARD
          </h1>
          <p className="mt-3 max-w-lg" style={{ opacity: 0.6, fontSize: 15, lineHeight: 1.55 }}>
            A shared canvas you join with a six-character code. Draw together, talk over a call,
            and let the AI turn the mess into a clean diagram.
          </p>
        </header>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={create}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 transition-opacity disabled:opacity-50"
            style={{ background: 'var(--canvas-ink)', color: 'var(--canvas-bg)', fontSize: 15, fontWeight: 500 }}
          >
            <Plus size={18} strokeWidth={2} />
            New board
          </button>

          <form onSubmit={join} className="flex flex-1 gap-2">
            <input
              value={code}
              onChange={(e) => {
                // Filter to the code alphabet as you type, so an ambiguous character can never
                // be entered in the first place.
                const next = e.target.value
                  .toUpperCase()
                  .split('')
                  .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
                  .join('')
                  .slice(0, ROOM_CODE_LENGTH);
                setCode(next);
                setError(null);
              }}
              placeholder="ENTER CODE"
              aria-label="Board code"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl px-4 outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 16,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                background: 'transparent',
                color: 'var(--canvas-ink)',
                border: '1.5px solid var(--canvas-grid)',
              }}
            />
            <button
              type="submit"
              disabled={busy || code.length !== ROOM_CODE_LENGTH}
              aria-label="Join board"
              className="grid w-12 shrink-0 place-items-center rounded-xl transition-opacity disabled:opacity-30"
              style={{ border: '1.5px solid var(--canvas-grid)' }}
            >
              <ArrowRight size={18} strokeWidth={2} />
            </button>
          </form>
        </div>

        {error && (
          <p role="alert" className="mt-3" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </p>
        )}

        {recents.length > 0 && (
          <section className="mt-14">
            <h2
              className="mb-3 flex items-center gap-1.5"
              style={{
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                opacity: 0.45,
              }}
            >
              <Clock size={12} strokeWidth={2} /> Your boards
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recents.map((b) => (
                <li key={b.code}>
                  <div
                    className="group flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
                    style={{ border: '1px solid var(--canvas-grid)' }}
                  >
                    <button
                      onClick={() => onOpen(b.code)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className="shrink-0 rounded-md px-2 py-1"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          letterSpacing: '0.1em',
                          background: 'var(--canvas-grid)',
                        }}
                      >
                        {b.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 14 }}>
                          {b.title || 'Untitled board'}
                        </span>
                        <span className="block" style={{ fontSize: 11, opacity: 0.45 }}>
                          {relativeTime(b.visitedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        forgetBoard(b.code);
                        setRecents(getRecentBoards());
                      }}
                      aria-label={`Remove ${b.code} from your list`}
                      title="Remove from this list (the board itself is not deleted)"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-16" style={{ fontSize: 12, opacity: 0.4, lineHeight: 1.6 }}>
          Anyone with a board code can open and edit it. Codes are unguessable enough for casual
          use, but they are not authentication.
        </footer>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
