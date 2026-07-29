import type { AIFeatureId, AuthResponse, BoardMember, BoardRole, PublicUser } from '@board/shared';

const HTTP_BASE = import.meta.env.VITE_SERVER_HTTP ?? '';

/**
 * In dev, Vite proxies /api and /yjs to the server, so a relative URL works and there is no CORS
 * preflight. In production VITE_SERVER_HTTP points at the deployed server.
 */
export function wsUrl(): string {
  const explicit = import.meta.env.VITE_SERVER_WS;
  if (explicit) return `${explicit}/yjs`;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // ws:// on an https:// page is blocked as mixed content and fails SILENTLY — always derive
  // the scheme from the page rather than hardcoding it.
  return `${proto}//${location.host}/yjs`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${HTTP_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (body as { message?: string }).message ?? `Request failed (${res.status})`,
      res.status,
      (body as { error?: string }).error,
    );
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface BoardMeta {
  id: string;
  code: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  readOnly: boolean;
}

export interface AccountBoard {
  id: string;
  code: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  role: BoardRole;
}

export const api = {
  createBoard: (title?: string) =>
    request<{ id: string; code: string; viewCode: string; title: string }>('/api/boards', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getBoard: (code: string) => request<BoardMeta>(`/api/boards/${encodeURIComponent(code)}`),

  setTitle: (code: string, title: string) =>
    request<{ ok: true }>(`/api/boards/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  getShareCodes: (code: string) =>
    request<{ code: string; viewCode: string }>(`/api/boards/${encodeURIComponent(code)}/share`),

  signup: (name: string, email: string, password: string) =>
    request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: PublicUser }>('/api/auth/me'),

  myBoards: () => request<{ boards: AccountBoard[] }>('/api/boards'),

  members: (code: string) =>
    request<{ members: BoardMember[] }>(`/api/boards/${encodeURIComponent(code)}/members`),

  invite: (code: string, email: string, role: 'editor' | 'viewer') =>
    request<{ member: BoardMember }>(`/api/boards/${encodeURIComponent(code)}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  removeMember: (code: string, target: { userId?: string; email?: string }) =>
    request<{ ok: true }>(`/api/boards/${encodeURIComponent(code)}/members`, {
      method: 'DELETE',
      body: JSON.stringify(target),
    }),

  ai: <T>(feature: AIFeatureId, room: string, userId: string, payload: unknown) =>
    request<{ ok: true; data: T; provider: string; cached: boolean; ms: number }>(
      `/api/ai/${feature}`,
      { method: 'POST', body: JSON.stringify({ room, userId, payload }) },
    ),
};

const AUTH_TOKEN_KEY = 'board:authToken';
const AUTH_USER_KEY = 'board:authUser';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

export function saveAuth(session: AuthResponse): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, session.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  } catch {
    /* persistence is optional in private browsing */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Local board list — "my boards", stored per browser
// ---------------------------------------------------------------------------

export interface RecentBoard {
  code: string;
  title: string;
  visitedAt: number;
}

const RECENT_KEY_PREFIX = 'board:recentBoards';

function recentBoardsKey(): string {
  const user = getStoredUser();
  return user ? `${RECENT_KEY_PREFIX}:${user.id}` : `${RECENT_KEY_PREFIX}:anon`;
}

/**
 * The board list is stored locally rather than server-side.
 *
 * Boards are anonymous and joined by code, so there is no account to hang a server-side list
 * from. Keeping it local preserves zero-friction joining while still giving a real dashboard.
 * Real accounts are the documented next step.
 */
export function getRecentBoards(): RecentBoard[] {
  try {
    const list = JSON.parse(localStorage.getItem(recentBoardsKey()) ?? '[]') as RecentBoard[];
    return list.filter((b) => b?.code).sort((a, b) => b.visitedAt - a.visitedAt);
  } catch {
    return [];
  }
}

export function rememberBoard(code: string, title: string): void {
  try {
    const list = getRecentBoards().filter((b) => b.code !== code);
    list.unshift({ code, title, visitedAt: Date.now() });
    localStorage.setItem(recentBoardsKey(), JSON.stringify(list.slice(0, 24)));
  } catch {
    /* private mode — the list is a convenience, not state worth failing over */
  }
}

export function forgetBoard(code: string): void {
  try {
    localStorage.setItem(recentBoardsKey(), JSON.stringify(getRecentBoards().filter((b) => b.code !== code)));
  } catch {
    /* ignore */
  }
}
