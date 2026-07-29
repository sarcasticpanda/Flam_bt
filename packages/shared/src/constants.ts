/**
 * Shared constants. Zero dependencies — imported by the engine, the client, and the server.
 */

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

/**
 * Deliberately excludes 0/O and 1/I/L.
 *
 * These are exactly the characters people get wrong when reading a code aloud across a room,
 * which is the primary way a code actually travels. The per-character boxed mono treatment in
 * the UI solves the same problem visually; this solves it at the source.
 *
 * 31^6 ≈ 8.9e8 — unguessable enough for casual use, and explicitly NOT access control.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

// ---------------------------------------------------------------------------
// Participant colours
// ---------------------------------------------------------------------------

/**
 * 12 OKLCH hue angles. THEME-INVARIANT — never override these per theme.
 *
 * Identity is carried by hue so "Ana is the red one" survives a theme switch. Each theme sets
 * only the lightness (`--p-l`) and chroma (`--p-c`) these hues resolve at, which is what keeps
 * all 12 legible on surfaces ranging from #FBFAF7 to #0C1A2B.
 *
 * See docs/05-DESIGN-SYSTEM.md and the DECISIONS.md entry on participant colour.
 */
export const PARTICIPANT_HUES = [
  12, 38, 85, 145, 178, 220, 258, 292, 322, 350, 55, 165,
] as const;

export const PARTICIPANT_COUNT = PARTICIPANT_HUES.length;

/** Resolve a participant hue index to a concrete colour for the active theme. */
export function participantColor(index: number, lightness = 0.55, chroma = 0.14): string {
  const hue = PARTICIPANT_HUES[index % PARTICIPANT_COUNT] ?? 12;
  return `oklch(${lightness} ${chroma} ${hue})`;
}

// ---------------------------------------------------------------------------
// Content colours (NOT chrome — these do not shift with the theme)
// ---------------------------------------------------------------------------

/** A yellow note is yellow on every board, in every theme. */
export const STICKY_COLORS = [
  '#FBE39A',
  '#F9C7A6',
  '#F5A7A7',
  '#D9C2F0',
  '#B7D9F2',
  '#B6E3C6',
  '#E6E2D8',
  '#F2D0E3',
] as const;

export const THEMES = ['paper', 'ink', 'slate', 'blueprint', 'contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/**
 * Spatial index cell size in world units.
 *
 * Tuned for typical shape sizes (sticky 180, process box 160). Too small and a large shape
 * touches dozens of cells on every drag update; too large and queries stop discriminating.
 */
export const GRID_CELL_SIZE = 512;

/** Extra world-space padding on the cull query, so shapes entering the viewport are never late. */
export const CULL_PADDING = 200;

/** Below this zoom, render simplified geometry. See docs/02-ARCHITECTURE.md §6. */
export const LOD_ZOOM_THRESHOLD = 0.25;
export const LOD_MICRO_THRESHOLD = 0.1;

export const STICKY_SIZE = 180;

export const STROKE_WIDTHS = [2, 4, 8, 16] as const;

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/** Awareness (cursor) update rate. 30Hz glides after interpolation without flooding the socket. */
export const AWARENESS_THROTTLE_MS = 1000 / 30;

/** Yjs document writes during a drag. The authoritative value is written on pointerup. */
export const DRAG_WRITE_THROTTLE_MS = 1000 / 30;

/** Server-side persistence debounce. */
export const PERSIST_IDLE_MS = 5_000;
export const PERSIST_MAX_MS = 30_000;

export const MAX_CALL_PEERS = 6;
export const CALL_DEGRADE_WARN_PEERS = 4;

// ---------------------------------------------------------------------------
// AI guardrails
// ---------------------------------------------------------------------------

export const AI_MAX_INPUT_CHARS = 12_000;
export const AI_RATE_ROOM_PER_MIN = 20;
export const AI_RATE_USER_PER_HOUR = 60;
export const AI_TIMEOUT_MS = 30_000;
export const AI_CACHE_TTL_MS = 5 * 60 * 1000;

export const AI_FEATURES = ['brainstorm', 'cluster', 'cleanup', 'mindmap'] as const;
export type AIFeatureId = (typeof AI_FEATURES)[number];

export const AI_PROVIDERS = ['groq', 'gemini', 'openrouter', 'demo'] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BOARD_BYTES = 100 * 1024 * 1024;
