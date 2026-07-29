import { useState } from 'react';
import type { PublicUser } from '@board/shared';
import { api, saveAuth } from '../lib/api';

export function AuthDialog({ onDone, onClose }: { onDone: (user: PublicUser) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = mode === 'login'
        ? await api.login(email, password)
        : await api.signup(name, email, password);
      saveAuth(session);
      onDone(session.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="presentation">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl p-6 shadow-xl"
        style={{ background: 'var(--canvas-bg)', color: 'var(--canvas-ink)', border: '1px solid var(--canvas-grid)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>
              {mode === 'login' ? 'Welcome back' : 'Create an account'}
            </h2>
            <p className="mt-1" style={{ fontSize: 13, opacity: 0.6 }}>
              Accounts keep your boards and invitations in one place.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-xl opacity-60">×</button>
        </div>

        <div className="mt-5 grid gap-3">
          {mode === 'signup' && (
            <label className="grid gap-1" style={{ fontSize: 12 }}>
              Name
              <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg px-3 py-2 outline-none" style={{ border: '1px solid var(--canvas-grid)', background: 'transparent' }} />
            </label>
          )}
          <label className="grid gap-1" style={{ fontSize: 12 }}>
            Email
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-lg px-3 py-2 outline-none" style={{ border: '1px solid var(--canvas-grid)', background: 'transparent' }} />
          </label>
          <label className="grid gap-1" style={{ fontSize: 12 }}>
            Password
            <input required type="password" minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-lg px-3 py-2 outline-none" style={{ border: '1px solid var(--canvas-grid)', background: 'transparent' }} />
          </label>
        </div>
        {error && <p role="alert" className="mt-3" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg px-4 py-2.5 disabled:opacity-50" style={{ background: 'var(--canvas-ink)', color: 'var(--canvas-bg)' }}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }} className="mt-3 w-full text-center" style={{ fontSize: 13, opacity: 0.65 }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
