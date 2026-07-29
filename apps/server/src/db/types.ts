import type { BoardMember } from '@board/shared';

/**
 * Storage contract, shared by the SQLite and Postgres backends.
 *
 * Every method is async even though SQLite answers synchronously. A sync interface would work
 * locally and then need every one of its ~26 call sites rewritten the day Postgres arrived —
 * exactly the kind of migration that gets half-done and leaves a mixed codebase behind.
 */

export interface BoardRow {
  id: string;
  code: string;
  view_code: string;
  title: string;
  owner_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: number;
}

export interface MemberRow {
  board_id: string;
  email: string;
  user_id: string | null;
  name: string | null;
  role: string;
  invited_at: number;
}

export interface VersionRow {
  id: string;
  label: string;
  author: string;
  created_at: number;
}

export interface Store {
  /** Create tables and run migrations. Must be awaited before serving traffic. */
  init(): Promise<void>;
  close(): Promise<void>;
  /** Which backend actually loaded — surfaced in /healthz so a misconfigured deploy is obvious. */
  readonly driver: 'sqlite' | 'postgres';

  // --- boards ---
  createBoard(
    id: string, code: string, viewCode: string, title: string, ownerId: string | null,
  ): Promise<BoardRow>;
  findByAnyCode(code: string): Promise<{ board: BoardRow; readOnly: boolean } | null>;
  setTitle(id: string, title: string): Promise<void>;

  // --- document state ---
  loadDoc(boardId: string): Promise<Uint8Array | null>;
  saveDoc(boardId: string, update: Uint8Array): Promise<void>;

  // --- versions ---
  saveVersion(
    id: string, boardId: string, label: string, author: string, ydoc: Uint8Array,
  ): Promise<void>;
  listVersions(boardId: string): Promise<VersionRow[]>;
  getVersion(id: string): Promise<Uint8Array | null>;

  // --- accounts ---
  createUser(id: string, email: string, passwordHash: string, name: string): Promise<UserRow>;
  userByEmail(email: string): Promise<UserRow | null>;
  userById(id: string): Promise<UserRow | null>;

  // --- membership ---
  boardsForUser(userId: string): Promise<BoardRow[]>;
  roleFor(boardId: string, userId: string): Promise<string | null>;
  accessFor(board: BoardRow, userId: string): Promise<BoardMember['role'] | null>;
  inviteMember(boardId: string, email: string, role: string): Promise<BoardMember>;
  listMembers(boardId: string): Promise<MemberRow[]>;
  removeMember(boardId: string, target: { userId?: string; email?: string }): Promise<void>;
}

/** Ownership is a pure comparison — no query, so it stays sync on both backends. */
export function isOwner(board: BoardRow, userId: string | undefined): boolean {
  return !!userId && board.owner_id === userId;
}

/**
 * Shared SQL. Both backends run the same logical schema; only the dialect differs.
 *
 * Postgres uses BYTEA and $1 placeholders; SQLite uses BLOB and ?. Timestamps are epoch
 * milliseconds as BIGINT/INTEGER on both, rather than a native timestamp type, so the two
 * backends round-trip identical values and no timezone handling creeps in.
 */
export const SCHEMA_NOTE = `
users        (id, email UNIQUE, password_hash, name, created_at)
boards       (id, code UNIQUE, view_code UNIQUE, title, owner_id -> users, created_at, updated_at)
board_state  (board_id PK -> boards, ydoc BLOB, updated_at)
board_versions (id, board_id -> boards, label, author, ydoc BLOB, created_at)
board_members  (board_id, email, PK(board_id,email), user_id -> users, name, role, invited_at)
`;
