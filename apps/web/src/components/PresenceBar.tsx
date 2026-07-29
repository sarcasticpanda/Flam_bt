import { useState } from 'react';
import { Check, Copy, LogOut, Users } from 'lucide-react';
import type { ConnectionStatus, Peer, Session } from '../collab/Session';

/**
 * Top-right chrome: connection status, room code, presence stack, leave.
 *
 * The presence stack is the one place participant colour appears in the chrome, which is exactly
 * the signature rule working as intended — the room is greyscale until people arrive.
 */
export function PresenceBar({
  session,
  peers,
  status,
  code,
  title,
  readOnly,
  onLeave,
  onRename,
}: {
  session: Session | null;
  peers: Peer[];
  status: ConnectionStatus;
  code: string;
  title: string;
  readOnly: boolean;
  onLeave: () => void;
  onRename: (title: string) => void;
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? code : `${location.origin}/b/${code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked — the code is visible on screen to type manually */
    }
  };

  const visible = peers.slice(0, 4);
  const overflow = peers.length - visible.length;

  return (
    <div className="pointer-events-auto flex items-center gap-2">
      {/* Board title */}
      <div className="surface flex h-10 items-center px-3">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim()) onRename(draft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(title);
                setEditing(false);
              }
            }}
            className="w-40 bg-transparent outline-none"
            style={{ color: 'var(--chrome-fg)', fontSize: 13 }}
            aria-label="Board title"
          />
        ) : (
          <button
            onClick={() => !readOnly && setEditing(true)}
            className="max-w-[180px] truncate"
            style={{ color: 'var(--chrome-fg)', fontSize: 13 }}
            title={readOnly ? 'View-only' : 'Rename board'}
          >
            {title || 'Untitled board'}
          </button>
        )}
        {readOnly && (
          <span
            className="ml-2 rounded px-1.5 py-0.5"
            style={{ fontSize: 10, background: 'var(--chrome-raised)', color: 'var(--chrome-fg-dim)' }}
          >
            view only
          </span>
        )}
      </div>

      {/* Room code — mono, boxed per character, because a code is a thing you read aloud. */}
      <button
        onClick={() => copy('code')}
        className="surface flex h-10 items-center gap-1 px-2.5"
        title="Copy board code"
        aria-label={`Board code ${code}. Click to copy.`}
      >
        {code.split('').map((ch, i) => (
          <span
            key={i}
            className="grid h-6 w-[18px] place-items-center rounded-[3px]"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--chrome-fg)',
              border: '1px solid var(--chrome-hairline)',
              background: copied === 'code' ? 'var(--chrome-fg)' : 'transparent',
              transition: 'background 140ms ease-out',
            }}
          >
            {copied === 'code' ? '' : ch}
          </span>
        ))}
      </button>

      <button
        onClick={() => copy('link')}
        className="surface grid h-10 w-10 place-items-center transition-colors hover:bg-[var(--chrome-raised)]"
        title="Copy invite link"
        aria-label="Copy invite link"
        style={{ color: 'var(--chrome-fg)' }}
      >
        {copied === 'link' ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.75} />}
      </button>

      {/* Presence */}
      <div className="surface flex h-10 items-center gap-2 px-3">
        <ConnectionDot status={status} />
        {peers.length === 0 ? (
          <span
            className="flex items-center gap-1.5"
            style={{ color: 'var(--chrome-fg-dim)', fontSize: 12 }}
          >
            <Users size={13} strokeWidth={1.75} />
            Only you
          </span>
        ) : (
          <div className="flex items-center -space-x-1.5">
            {visible.map((p) => (
              <button
                key={p.clientId}
                onClick={() => session?.jumpTo(p.clientId)}
                title={`${p.state.name} — click to jump to their view`}
                aria-label={`Jump to ${p.state.name}`}
                className="grid h-6 w-6 place-items-center rounded-full transition-transform hover:scale-110"
                style={{
                  background: session?.colorFor(p.state.colorIndex) ?? '#888',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  border: '2px solid var(--chrome-bg)',
                }}
              >
                {initials(p.state.name)}
              </button>
            ))}
            {overflow > 0 && (
              <span
                className="grid h-6 w-6 place-items-center rounded-full"
                style={{
                  background: 'var(--chrome-raised)',
                  color: 'var(--chrome-fg)',
                  fontSize: 10,
                  border: '2px solid var(--chrome-bg)',
                }}
              >
                +{overflow}
              </span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onLeave}
        className="surface grid h-10 w-10 place-items-center transition-colors hover:bg-[var(--chrome-raised)]"
        title="Leave board"
        aria-label="Leave board"
        style={{ color: 'var(--chrome-fg)' }}
      >
        <LogOut size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { color: string; label: string }> = {
    connected: { color: 'var(--success)', label: 'Connected' },
    connecting: { color: '#C9A227', label: 'Connecting…' },
    disconnected: { color: 'var(--danger)', label: 'Offline — changes saved here' },
  };
  const { color, label } = map[status];
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
      title={label}
      role="status"
      aria-label={label}
    />
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
