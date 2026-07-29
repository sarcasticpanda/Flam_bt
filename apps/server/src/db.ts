import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BoardMember } from '@board/shared';

/**
 * Persistence.
 *
 * Uses `node:sqlite`, built into Node 22+, rather than better-sqlite3. That avoids native
 * compilation entirely — a real time sink on Windows, and a common cause of "works on my
 * machine" in a monorepo.
 *
 * Production swaps this for Postgres via DATABASE_URL: free-tier hosts have EPHEMERAL disks, so
 * a SQLite file there is wiped on every redeploy and demo boards would silently vanish.
 */

const SQLITE_PATH = process.env.SQLITE_PATH ?? './data/board.db';

mkdirSync(dirname(SQLITE_PATH), { recursive: true });

const db = new DatabaseSync(SQLITE_PATH);

// WAL lets reads proceed during a write. The persistence path writes whole-document blobs on a
// debounce, and without WAL those writes block every concurrent room read.
db.exec(`PRAGMA journal_mode = WAL;`);

db.exec(`
  -- Accounts. Layered on top of the anonymous-by-code flow, never required by it: a board
  -- created with no logged-in user has owner_id NULL and works exactly as before. Created
  -- before 'boards' since that table references it.
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boards (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    view_code   TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled board',
    owner_id    TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS board_state (
    board_id    TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
    ydoc        BLOB NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS board_versions (
    id          TEXT PRIMARY KEY,
    board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    author      TEXT NOT NULL,
    ydoc        BLOB NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS board_versions_board_idx
    ON board_versions (board_id, created_at DESC);

  -- One row per (board, invited email). user_id starts NULL for an invite sent to someone
  -- without an account yet, and is resolved the moment a matching email logs in — so "invite by
  -- email" works without an email-sending service, which is out of reach in a free/local setup.
  CREATE TABLE IF NOT EXISTS board_members (
    board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    user_id     TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    name        TEXT NULL,
    role        TEXT NOT NULL DEFAULT 'editor',
    invited_at  INTEGER NOT NULL,
    PRIMARY KEY (board_id, email)
  );

  CREATE INDEX IF NOT EXISTS board_members_user_idx ON board_members (user_id);
  CREATE INDEX IF NOT EXISTS board_members_email_idx ON board_members (email);
`);

// Migration for a database created before accounts existed: CREATE TABLE IF NOT EXISTS above
// leaves an already-present 'boards' table exactly as it was, so a pre-existing local dev DB
// would be missing owner_id entirely. Add it if absent, rather than requiring anyone to delete
// their data.
{
  const cols = db.prepare(`PRAGMA table_info(boards)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'owner_id')) {
    db.exec(`ALTER TABLE boards ADD COLUMN owner_id TEXT NULL REFERENCES users(id)`);
  }
}
// This index must be created after the migration above. An existing database from before
// accounts has no owner_id yet; creating the index inside the initial schema batch prevents the
// server from starting before it reaches ALTER TABLE.
db.exec(`CREATE INDEX IF NOT EXISTS boards_owner_idx ON boards (owner_id)`);

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

const stmts = {
  insertBoard: db.prepare(
    `INSERT INTO boards (id, code, view_code, title, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  byCode: db.prepare(`SELECT * FROM boards WHERE code = ?`),
  byViewCode: db.prepare(`SELECT * FROM boards WHERE view_code = ?`),
  touch: db.prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`),
  setTitle: db.prepare(`UPDATE boards SET title = ?, updated_at = ? WHERE id = ?`),
  getState: db.prepare(`SELECT ydoc FROM board_state WHERE board_id = ?`),
  putState: db.prepare(
    `INSERT INTO board_state (board_id, ydoc, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(board_id) DO UPDATE SET ydoc = excluded.ydoc, updated_at = excluded.updated_at`,
  ),
  insertVersion: db.prepare(
    `INSERT INTO board_versions (id, board_id, label, author, ydoc, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  listVersions: db.prepare(
    `SELECT id, label, author, created_at FROM board_versions
     WHERE board_id = ? ORDER BY created_at DESC LIMIT 50`,
  ),
  getVersion: db.prepare(`SELECT ydoc FROM board_versions WHERE id = ?`),

  // --- accounts ---
  insertUser: db.prepare(
    `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ),
  userByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  userById: db.prepare(`SELECT * FROM users WHERE id = ?`),

  // --- membership ---
  boardsOwned: db.prepare(`SELECT * FROM boards WHERE owner_id = ? ORDER BY updated_at DESC`),
  boardsMemberOf: db.prepare(
    `SELECT b.* FROM boards b
     JOIN board_members m ON m.board_id = b.id
     WHERE m.user_id = ? ORDER BY b.updated_at DESC`,
  ),
  upsertMember: db.prepare(
    `INSERT INTO board_members (board_id, email, user_id, name, role, invited_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(board_id, email) DO UPDATE SET role = excluded.role`,
  ),
  membersForBoard: db.prepare(`SELECT * FROM board_members WHERE board_id = ?`),
  removeMemberByUser: db.prepare(`DELETE FROM board_members WHERE board_id = ? AND user_id = ?`),
  removeMemberByEmail: db.prepare(`DELETE FROM board_members WHERE board_id = ? AND email = ?`),
  // Resolves pending invites the moment an account with a matching email appears — this is what
  // makes "invite by email" work without an email-sending service: the invite is already
  // waiting for them the first time they log in.
  resolvePendingInvites: db.prepare(
    `UPDATE board_members SET user_id = ?, name = ? WHERE email = ? AND user_id IS NULL`,
  ),
  memberRole: db.prepare(
    `SELECT role FROM board_members WHERE board_id = ? AND user_id = ?`,
  ),
};

export const store = {
  createBoard(id: string, code: string, viewCode: string, title: string, ownerId: string | null): BoardRow {
    const now = Date.now();
    stmts.insertBoard.run(id, code, viewCode, title, ownerId, now, now);
    return { id, code, view_code: viewCode, title, owner_id: ownerId, created_at: now, updated_at: now };
  },

  /**
   * Resolve either code. The view code returns the same board with readOnly = true, which is how
   * view-only access is enforced SERVER-SIDE rather than by hiding buttons in the UI.
   */
  findByAnyCode(code: string): { board: BoardRow; readOnly: boolean } | null {
    const upper = code.toUpperCase();
    const edit = stmts.byCode.get(upper) as BoardRow | undefined;
    if (edit) return { board: edit, readOnly: false };
    const view = stmts.byViewCode.get(upper) as BoardRow | undefined;
    if (view) return { board: view, readOnly: true };
    return null;
  },

  setTitle(id: string, title: string): void {
    stmts.setTitle.run(title, Date.now(), id);
  },

  loadDoc(boardId: string): Uint8Array | null {
    const row = stmts.getState.get(boardId) as { ydoc: Uint8Array } | undefined;
    return row?.ydoc ?? null;
  },

  saveDoc(boardId: string, update: Uint8Array): void {
    const now = Date.now();
    stmts.putState.run(boardId, update, now);
    stmts.touch.run(now, boardId);
  },

  saveVersion(id: string, boardId: string, label: string, author: string, ydoc: Uint8Array): void {
    stmts.insertVersion.run(id, boardId, label, author, ydoc, Date.now());
  },

  listVersions(boardId: string) {
    return stmts.listVersions.all(boardId);
  },

  getVersion(id: string): Uint8Array | null {
    const row = stmts.getVersion.get(id) as { ydoc: Uint8Array } | undefined;
    return row?.ydoc ?? null;
  },

  // --- accounts ---

  createUser(id: string, email: string, passwordHash: string, name: string): UserRow {
    const now = Date.now();
    stmts.insertUser.run(id, email, passwordHash, name, now);
    // A signup can arrive after boards already invited this email — attach them immediately
    // rather than making the new user hunt for a board someone shared with them earlier.
    stmts.resolvePendingInvites.run(id, name, email);
    return { id, email, password_hash: passwordHash, name, created_at: now };
  },

  userByEmail(email: string): UserRow | null {
    return (stmts.userByEmail.get(email.toLowerCase()) as UserRow | undefined) ?? null;
  },

  userById(id: string): UserRow | null {
    return (stmts.userById.get(id) as UserRow | undefined) ?? null;
  },

  // --- membership ---

  /** Every board a user can see: boards they own, plus boards they were invited to. */
  boardsForUser(userId: string): BoardRow[] {
    const owned = stmts.boardsOwned.all(userId) as unknown as BoardRow[];
    const memberOf = stmts.boardsMemberOf.all(userId) as unknown as BoardRow[];
    const seen = new Set(owned.map((b) => b.id));
    return [...owned, ...memberOf.filter((b) => !seen.has(b.id))].sort(
      (a, b) => b.updated_at - a.updated_at,
    );
  },

  isOwner(board: BoardRow, userId: string | undefined): boolean {
    return !!userId && board.owner_id === userId;
  },

  roleFor(boardId: string, userId: string): string | null {
    const row = stmts.memberRole.get(boardId, userId) as { role: string } | undefined;
    return row?.role ?? null;
  },

  /** Returns the server-authoritative access level. Codes identify a board; they are not access. */
  accessFor(board: BoardRow, userId: string): BoardMember['role'] | null {
    if (board.owner_id === userId) return 'owner';
    return store.roleFor(board.id, userId) as BoardMember['role'] | null;
  },

  /**
   * Invite by email. If that email already has an account, the membership resolves to their
   * user_id immediately; otherwise it sits as `pending` until they sign up or log in with a
   * matching email — see resolvePendingInvites.
   */
  inviteMember(boardId: string, email: string, role: string): BoardMember {
    const normalized = email.toLowerCase();
    const existing = store.userByEmail(normalized);
    stmts.upsertMember.run(
      boardId,
      normalized,
      existing?.id ?? null,
      existing?.name ?? null,
      role,
      Date.now(),
    );
    return {
      userId: existing?.id ?? null,
      email: normalized,
      name: existing?.name ?? null,
      role: role as BoardMember['role'],
      pending: !existing,
      invitedAt: Date.now(),
    };
  },

  listMembers(boardId: string): MemberRow[] {
    return stmts.membersForBoard.all(boardId) as unknown as MemberRow[];
  },

  removeMember(boardId: string, target: { userId?: string; email?: string }): void {
    if (target.userId) stmts.removeMemberByUser.run(boardId, target.userId);
    else if (target.email) stmts.removeMemberByEmail.run(boardId, target.email.toLowerCase());
  },
};

export function closeDb(): void {
  db.close();
}
