import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { getChat, type ChatMessage } from '@board/shared';
import type { BoardDoc } from '../collab/BoardDoc';

/** Persistent, board-scoped chat. It is a Y.Array, so it follows the same realtime and offline
 * merge semantics as shapes instead of being a separate, lossy websocket feature. */
export function ChatPanel({ doc, identity, readOnly }: {
  doc: BoardDoc | null;
  identity: { userId: string; name: string; colorIndex: number };
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doc) return;
    const chat = getChat(doc.doc);
    const sync = () => setMessages(chat.toArray().slice(-100));
    sync();
    chat.observe(sync);
    return () => chat.unobserve(sync);
  }, [doc]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages, open]);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!doc || !text || readOnly) return;
    getChat(doc.doc).push([{
      id: crypto.randomUUID(), author: identity.name, authorId: identity.userId,
      colorIndex: identity.colorIndex, text: text.slice(0, 1_000), ts: Date.now(),
    }]);
    setDraft('');
  };

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-40">
      {open && (
        <section className="mb-2 flex h-96 w-80 flex-col overflow-hidden rounded-xl shadow-xl" style={{ background: 'var(--chrome-bg)', border: '1px solid var(--chrome-hairline)', color: 'var(--chrome-fg)' }}>
          <header className="flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: 'var(--chrome-hairline)' }}>
            <strong style={{ fontSize: 13 }}>Board chat</strong>
            <button onClick={() => setOpen(false)} aria-label="Close chat"><X size={16} /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && <p style={{ fontSize: 12, opacity: 0.55 }}>Messages stay with this board.</p>}
            {messages.map((message) => (
              <article key={message.id}>
                <div className="flex items-baseline gap-2"><b style={{ fontSize: 12, color: `oklch(58% .14 ${message.colorIndex * 47})` }}>{message.author}</b><time style={{ fontSize: 10, opacity: 0.45 }}>{new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                <p className="mt-0.5 whitespace-pre-wrap break-words" style={{ fontSize: 13 }}>{message.text}</p>
              </article>
            ))}
            <div ref={endRef} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t p-2" style={{ borderColor: 'var(--chrome-hairline)' }}>
            <input disabled={readOnly} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={readOnly ? 'Viewers cannot chat' : 'Message everyone…'} className="min-w-0 flex-1 rounded-md px-2 py-1.5 outline-none" style={{ background: 'var(--chrome-raised)', fontSize: 12 }} />
            <button disabled={readOnly || !draft.trim()} aria-label="Send message"><Send size={16} /></button>
          </form>
        </section>
      )}
      <button onClick={() => setOpen((value) => !value)} className="surface grid h-10 w-10 place-items-center rounded-lg shadow-lg" aria-label="Open board chat" title="Board chat">
        <MessageCircle size={18} />
      </button>
    </div>
  );
}
