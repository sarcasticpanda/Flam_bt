/**
 * Socket.IO event names and payloads for the /rtc signaling namespace.
 *
 * Typed on both ends so a rename cannot silently break signaling — which is otherwise one of the
 * hardest classes of bug to spot, because a mistyped event name fails completely silently.
 */
import type { ShapeId } from './shape.js';

export const RTC_NAMESPACE = '/rtc';

export interface RtcPeer {
  peerId: string;
  userId: string;
  name: string;
  colorIndex: number;
}

/** Client -> server. */
export interface ClientToServerEvents {
  'rtc:join': (p: { room: string; userId: string; name: string; colorIndex: number }) => void;
  'rtc:leave': (p: { room: string }) => void;
  'rtc:signal': (p: { room: string; to: string; data: unknown }) => void;
}

/** Server -> client. */
export interface ServerToClientEvents {
  /** Sent to the joiner with everyone already present. The joiner initiates offers. */
  'rtc:peers': (p: { peers: RtcPeer[] }) => void;
  'rtc:peer-joined': (p: { peer: RtcPeer }) => void;
  'rtc:peer-left': (p: { peerId: string }) => void;
  'rtc:signal': (p: { from: string; data: unknown }) => void;
  /** Mesh is hard-capped; the 7th peer is refused with a reason rather than failing opaquely. */
  'rtc:full': (p: { limit: number }) => void;
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export interface CreateBoardResponse {
  id: string;
  code: string;
  viewCode: string;
  title: string;
}

export interface BoardMetaResponse {
  id: string;
  code: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** True when the client connected via the view-only code. */
  readOnly: boolean;
}

export interface AIRequestBody {
  room: string;
  userId: string;
  payload: unknown;
}

export interface AISuccessResponse<T = unknown> {
  ok: true;
  data: T;
  /** Which provider actually answered. Surfaced in the UI — `demo` must never look live. */
  provider: string;
  cached: boolean;
  ms: number;
}

export interface AIErrorResponse {
  ok: false;
  error: 'invalid_input' | 'invalid_output' | 'rate_limited' | 'timeout' | 'no_provider';
  message: string;
  retryAfter?: number;
}

export type AIResponse<T = unknown> = AISuccessResponse<T> | AIErrorResponse;

// ---------------------------------------------------------------------------
// Board activity (feeds AI meeting notes, and the presence log)
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  userId: string;
  name: string;
  action: 'created' | 'deleted' | 'ai';
  shapeIds: ShapeId[];
  ts: number;
}
