import type { AIFeatureId } from '@board/shared';

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
  const res = await fetch(`${HTTP_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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

  ai: <T>(feature: AIFeatureId, room: string, userId: string, payload: unknown) =>
    request<{ ok: true; data: T; provider: string; cached: boolean; ms: number }>(
      `/api/ai/${feature}`,
      { method: 'POST', body: JSON.stringify({ room, userId, payload }) },
    ),
};

// ---------------------------------------------------------------------------
// Local board list — "my boards", stored per browser
// ---------------------------------------------------------------------------

export interface RecentBoard {
  code: string;
  title: string;
  visitedAt: number;
}

const RECENT_KEY = 'board:recentBoards';

/**
 * The board list is stored locally rather than server-side.
 *
 * Boards are anonymous and joined by code, so there is no account to hang a server-side list
 * from. Keeping it local preserves zero-friction joining while still giving a real dashboard.
 * Real accounts are the documented next step.
 */
export function getRecentBoards(): RecentBoard[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentBoard[];
    return list.filter((b) => b?.code).sort((a, b) => b.visitedAt - a.visitedAt);
  } catch {
    return [];
  }
}

export function rememberBoard(code: string, title: string): void {
  try {
    const list = getRecentBoards().filter((b) => b.code !== code);
    list.unshift({ code, title, visitedAt: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24)));
  } catch {
    /* private mode — the list is a convenience, not state worth failing over */
  }
}

export function forgetBoard(code: string): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(getRecentBoards().filter((b) => b.code !== code)),
    );
  } catch {
    /* ignore */
  }
}
