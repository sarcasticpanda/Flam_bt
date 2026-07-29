import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BoardMember } from '@board/shared';
import type { BoardRow, MemberRow, Store, UserRow, VersionRow } from './types.js';

/**
 * SQLite backend — local development only.
 *
 * `node:sqlite` is built into Node 22+, so there is no native compile step (a real time sink on
 * Windows). It answers synchronously; the methods below are async purely to satisfy the shared
 * Store contract, so swapping to Postgres needs no call-site changes.
 *
 * NOT for production: free hosting tiers have ephemeral disks and would wipe this file on every
 * redeploy. `createStore` refuses to select it when NODE_ENV=production.
 */
export function createSqliteStore(path: string): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  // WAL lets reads proceed during a write. Persistence writes whole-document blobs on a
  // debounce, and without WAL those block every concurrent room read.
  db.exec(`PRAGMA journal_mode = WAL;`);
  // Off by default in SQLite; without it the REFERENCES clauses below are decorative.
  db.exec(`PRAGMA foreign_keys = ON;`);

  db.exec(`
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
    CREATE TABLE IF NOT EXISTS board_members (
      board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      user_id     TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      name        TEXT NULL,
      role        TEXT NOT NULL DEFAULT 'editor',
      invited_at  INTEGER NOT NULL,
      PRIMARY KEY (board_id, email)
    );
    CREATE INDEX IF NOT EXISTS board_versions_board_idx ON board_versions (board_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS board_members_user_idx   ON board_members (user_id);
    CREATE INDEX IF NOT EXISTS board_members_email_idx  ON board_members (email);
  `);

  // A database created before accounts existed keeps its old 'boards' table untouched by
  // CREATE TABLE IF NOT EXISTS, so owner_id would be missing entirely. Add it rather than
  // making anyone delete their local data.
  const cols = db.prepare(`PRAGMA table_info(boards)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'owner_id')) {
    db.exec(`ALTER TABLE boards ADD COLUMN owner_id TEXT NULL REFERENCES users(id)`);
  }
  // After the migration, never inside the batch above — an older DB would not have the column yet.
  db.exec(`CREATE INDEX IF NOT EXISTS boards_owner_idx ON boards (owner_id)`);

  const s = {
    insertBoard: db.prepare(`INSERT INTO boards (id, code, view_code, title, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`),
    byCode: db.prepare(`SELECT * FROM boards WHERE code = ?`),
    byViewCode: db.prepare(`SELECT * FROM boards WHERE view_code = ?`),
    touch: db.prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`),
    setTitle: db.prepare(`UPDATE boards SET title = ?, updated_at = ? WHERE id = ?`),
    getState: db.prepare(`SELECT ydoc FROM board_state WHERE board_id = ?`),
    putState: db.prepare(`INSERT INTO board_state (board_id, ydoc, updated_at) VALUES (?,?,?) ON CONFLICT(board_id) DO UPDATE SET ydoc = excluded.ydoc, updated_at = excluded.updated_at`),
    insertVersion: db.prepare(`INSERT INTO board_versions (id, board_id, label, author, ydoc, created_at) VALUES (?,?,?,?,?,?)`),
    listVersions: db.prepare(`SELECT id, label, author, created_at FROM board_versions WHERE board_id = ? ORDER BY created_at DESC LIMIT 50`),
    getVersion: db.prepare(`SELECT ydoc FROM board_versions WHERE id = ?`),
    insertUser: db.prepare(`INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)`),
    userByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
    userById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    boardsOwned: db.prepare(`SELECT * FROM boards WHERE owner_id = ? ORDER BY updated_at DESC`),
    boardsMemberOf: db.prepare(`SELECT b.* FROM boards b JOIN board_members m ON m.board_id = b.id WHERE m.user_id = ? ORDER BY b.updated_at DESC`),
    upsertMember: db.prepare(`INSERT INTO board_members (board_id, email, user_id, name, role, invited_at) VALUES (?,?,?,?,?,?) ON CONFLICT(board_id, email) DO UPDATE SET role = excluded.role`),
    membersForBoard: db.prepare(`SELECT * FROM board_members WHERE board_id = ?`),
    removeByUser: db.prepare(`DELETE FROM board_members WHERE board_id = ? AND user_id = ?`),
    removeByEmail: db.prepare(`DELETE FROM board_members WHERE board_id = ? AND email = ?`),
    resolveInvites: db.prepare(`UPDATE board_members SET user_id = ?, name = ? WHERE email = ? AND user_id IS NULL`),
    memberRole: db.prepare(`SELECT role FROM board_members WHERE board_id = ? AND user_id = ?`),
  };

  const store: Store = {
    driver: 'sqlite',
    async init() {/* schema created above, synchronously */},
    async close() { db.close(); },

    async createBoard(id, code, viewCode, title, ownerId) {
      const now = Date.now();
      s.insertBoard.run(id, code, viewCode, title, ownerId, now, now);
      return { id, code, view_code: viewCode, title, owner_id: ownerId, created_at: now, updated_at: now };
    },

    async findByAnyCode(code) {
      const upper = code.toUpperCase();
      const edit = s.byCode.get(upper) as BoardRow | undefined;
      if (edit) return { board: edit, readOnly: false };
      const view = s.byViewCode.get(upper) as BoardRow | undefined;
      // The view code resolves the same board read-only. This is how view access is enforced
      // server-side rather than by hiding buttons in the UI.
      return view ? { board: view, readOnly: true } : null;
    },

    async setTitle(id, title) { s.setTitle.run(title, Date.now(), id); },

    async loadDoc(boardId) {
      const row = s.getState.get(boardId) as { ydoc: Uint8Array } | undefined;
      return row?.ydoc ?? null;
    },

    async saveDoc(boardId, update) {
      const now = Date.now();
      s.putState.run(boardId, update, now);
      s.touch.run(now, boardId);
    },

    async saveVersion(id, boardId, label, author, ydoc) {
      s.insertVersion.run(id, boardId, label, author, ydoc, Date.now());
    },

    async listVersions(boardId) { return s.listVersions.all(boardId) as unknown as VersionRow[]; },

    async getVersion(id) {
      const row = s.getVersion.get(id) as { ydoc: Uint8Array } | undefined;
      return row?.ydoc ?? null;
    },

    async createUser(id, email, passwordHash, name) {
      const now = Date.now();
      const normalized = email.toLowerCase();
      s.insertUser.run(id, normalized, passwordHash, name, now);
      // Attach invites that were waiting on this email.
      s.resolveInvites.run(id, name, normalized);
      return { id, email: normalized, password_hash: passwordHash, name, created_at: now };
    },

    async userByEmail(email) {
      return (s.userByEmail.get(email.toLowerCase()) as UserRow | undefined) ?? null;
    },

    async userById(id) { return (s.userById.get(id) as UserRow | undefined) ?? null; },

    async boardsForUser(userId) {
      const owned = s.boardsOwned.all(userId) as unknown as BoardRow[];
      const invited = s.boardsMemberOf.all(userId) as unknown as BoardRow[];
      const seen = new Set(owned.map((b) => b.id));
      return [...owned, ...invited.filter((b) => !seen.has(b.id))].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
    },

    async roleFor(boardId, userId) {
      const row = s.memberRole.get(boardId, userId) as { role: string } | undefined;
      return row?.role ?? null;
    },

    async accessFor(board, userId) {
      if (board.owner_id === userId) return 'owner';
      return (await store.roleFor(board.id, userId)) as BoardMember['role'] | null;
    },

    async inviteMember(boardId, email, role) {
      const normalized = email.toLowerCase();
      const existing = await store.userByEmail(normalized);
      const now = Date.now();
      s.upsertMember.run(boardId, normalized, existing?.id ?? null, existing?.name ?? null, role, now);
      return {
        userId: existing?.id ?? null,
        email: normalized,
        name: existing?.name ?? null,
        role: role as BoardMember['role'],
        pending: !existing,
        invitedAt: now,
      };
    },

    async listMembers(boardId) { return s.membersForBoard.all(boardId) as unknown as MemberRow[]; },

    async removeMember(boardId, target) {
      if (target.userId) s.removeByUser.run(boardId, target.userId);
      else if (target.email) s.removeByEmail.run(boardId, target.email.toLowerCase());
    },
  };

  return store;
}
