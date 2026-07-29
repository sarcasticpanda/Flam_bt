import type { BoardMember } from '@board/shared';
import type { BoardRow, MemberRow, Store, UserRow, VersionRow } from './types.js';

/**
 * Postgres backend — the production store.
 *
 * Exists because free hosting tiers have EPHEMERAL disks: a SQLite file on Render is wiped on
 * every redeploy, taking every account and board with it. That is the difference between a demo
 * and a product.
 *
 * Deliberately driver-agnostic: it takes anything exposing `query(text, params)`, so the same
 * code runs against `pg` in production and against PGlite in tests. That means the SQL below is
 * actually executed by a real Postgres engine in CI rather than only being hoped at.
 */

export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end?(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  view_code   TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL DEFAULT 'Untitled board',
  owner_id    TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_state (
  board_id    TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  ydoc        BYTEA NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_versions (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  author      TEXT NOT NULL,
  ydoc        BYTEA NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_members (
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  user_id     TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NULL,
  role        TEXT NOT NULL DEFAULT 'editor',
  invited_at  BIGINT NOT NULL,
  PRIMARY KEY (board_id, email)
);

CREATE INDEX IF NOT EXISTS boards_owner_idx          ON boards (owner_id);
CREATE INDEX IF NOT EXISTS board_versions_board_idx  ON board_versions (board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS board_members_user_idx    ON board_members (user_id);
CREATE INDEX IF NOT EXISTS board_members_email_idx   ON board_members (email);
`;

/**
 * Postgres returns BIGINT as a STRING to avoid silent precision loss past 2^53.
 *
 * Our timestamps are epoch-millis and comfortably inside the safe range, but they arrive as
 * "1785441317466" and would otherwise flow into the API as strings — sorting wrong and breaking
 * date maths in ways that only show up later.
 */
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

/** BYTEA arrives as a Node Buffer; Yjs wants a plain Uint8Array view of the same bytes. */
const bytes = (v: unknown): Uint8Array | null => {
  if (!v) return null;
  if (v instanceof Uint8Array) return v;
  return new Uint8Array(v as ArrayBufferLike);
};

const toBoard = (r: Record<string, unknown>): BoardRow => ({
  id: String(r.id),
  code: String(r.code),
  view_code: String(r.view_code),
  title: String(r.title),
  owner_id: r.owner_id === null || r.owner_id === undefined ? null : String(r.owner_id),
  created_at: num(r.created_at),
  updated_at: num(r.updated_at),
});

const toUser = (r: Record<string, unknown>): UserRow => ({
  id: String(r.id),
  email: String(r.email),
  password_hash: String(r.password_hash),
  name: String(r.name),
  created_at: num(r.created_at),
});

export function createPostgresStore(client: PgLike): Store {
  const q = (text: string, params?: unknown[]) => client.query(text, params);

  const store: Store = {
    driver: 'postgres',

    async init() {
      // Run statements one at a time. `pg` accepts a multi-statement string over the simple
      // query protocol, but PGlite (used in tests) and pooled/prepared paths do not — splitting
      // keeps the exact same schema working on every driver.
      for (const stmt of SCHEMA.split(';').map((x) => x.trim()).filter(Boolean)) {
        await q(stmt);
      }
    },

    async close() {
      await client.end?.();
    },

    // --- boards ---

    async createBoard(id, code, viewCode, title, ownerId) {
      const now = Date.now();
      await q(
        `INSERT INTO boards (id, code, view_code, title, owner_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, code, viewCode, title, ownerId, now, now],
      );
      return { id, code, view_code: viewCode, title, owner_id: ownerId, created_at: now, updated_at: now };
    },

    async findByAnyCode(code) {
      const upper = code.toUpperCase();
      // One round trip instead of two: the view_code match is what marks it read-only.
      const { rows } = await q(
        `SELECT *, (code = $1) AS is_edit FROM boards WHERE code = $1 OR view_code = $1 LIMIT 1`,
        [upper],
      );
      const row = rows[0];
      if (!row) return null;
      return { board: toBoard(row), readOnly: row.is_edit !== true };
    },

    async setTitle(id, title) {
      await q(`UPDATE boards SET title = $1, updated_at = $2 WHERE id = $3`, [title, Date.now(), id]);
    },

    // --- document state ---

    async loadDoc(boardId) {
      const { rows } = await q(`SELECT ydoc FROM board_state WHERE board_id = $1`, [boardId]);
      return rows[0] ? bytes(rows[0].ydoc) : null;
    },

    async saveDoc(boardId, update) {
      const now = Date.now();
      await q(
        `INSERT INTO board_state (board_id, ydoc, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (board_id) DO UPDATE SET ydoc = EXCLUDED.ydoc, updated_at = EXCLUDED.updated_at`,
        [boardId, Buffer.from(update), now],
      );
      await q(`UPDATE boards SET updated_at = $1 WHERE id = $2`, [now, boardId]);
    },

    // --- versions ---

    async saveVersion(id, boardId, label, author, ydoc) {
      await q(
        `INSERT INTO board_versions (id, board_id, label, author, ydoc, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, boardId, label, author, Buffer.from(ydoc), Date.now()],
      );
    },

    async listVersions(boardId) {
      const { rows } = await q(
        `SELECT id, label, author, created_at FROM board_versions
         WHERE board_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [boardId],
      );
      return rows.map((r): VersionRow => ({
        id: String(r.id),
        label: String(r.label),
        author: String(r.author),
        created_at: num(r.created_at),
      }));
    },

    async getVersion(id) {
      const { rows } = await q(`SELECT ydoc FROM board_versions WHERE id = $1`, [id]);
      return rows[0] ? bytes(rows[0].ydoc) : null;
    },

    // --- accounts ---

    async createUser(id, email, passwordHash, name) {
      const now = Date.now();
      const normalized = email.toLowerCase();
      await q(
        `INSERT INTO users (id, email, password_hash, name, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, normalized, passwordHash, name, now],
      );
      // Attach any invites that were waiting on this email — this is what makes "invite someone
      // who has no account yet" work without sending a single email.
      await q(
        `UPDATE board_members SET user_id = $1, name = $2 WHERE email = $3 AND user_id IS NULL`,
        [id, name, normalized],
      );
      return { id, email: normalized, password_hash: passwordHash, name, created_at: now };
    },

    async userByEmail(email) {
      const { rows } = await q(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
      return rows[0] ? toUser(rows[0]) : null;
    },

    async userById(id) {
      const { rows } = await q(`SELECT * FROM users WHERE id = $1`, [id]);
      return rows[0] ? toUser(rows[0]) : null;
    },

    // --- membership ---

    async boardsForUser(userId) {
      // Owned boards and invited boards in one query; UNION dedupes a board you own AND were
      // invited to, which happens after an ownership transfer.
      const { rows } = await q(
        `SELECT b.* FROM boards b WHERE b.owner_id = $1
         UNION
         SELECT b.* FROM boards b
           JOIN board_members m ON m.board_id = b.id
          WHERE m.user_id = $1
         ORDER BY updated_at DESC`,
        [userId],
      );
      return rows.map(toBoard);
    },

    async roleFor(boardId, userId) {
      const { rows } = await q(
        `SELECT role FROM board_members WHERE board_id = $1 AND user_id = $2`,
        [boardId, userId],
      );
      return rows[0] ? String(rows[0].role) : null;
    },

    async accessFor(board, userId) {
      if (board.owner_id === userId) return 'owner';
      return (await store.roleFor(board.id, userId)) as BoardMember['role'] | null;
    },

    async inviteMember(boardId, email, role) {
      const normalized = email.toLowerCase();
      const existing = await store.userByEmail(normalized);
      const now = Date.now();
      await q(
        `INSERT INTO board_members (board_id, email, user_id, name, role, invited_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (board_id, email) DO UPDATE SET role = EXCLUDED.role`,
        [boardId, normalized, existing?.id ?? null, existing?.name ?? null, role, now],
      );
      return {
        userId: existing?.id ?? null,
        email: normalized,
        name: existing?.name ?? null,
        role: role as BoardMember['role'],
        pending: !existing,
        invitedAt: now,
      };
    },

    async listMembers(boardId) {
      const { rows } = await q(`SELECT * FROM board_members WHERE board_id = $1`, [boardId]);
      return rows.map((r): MemberRow => ({
        board_id: String(r.board_id),
        email: String(r.email),
        user_id: r.user_id === null || r.user_id === undefined ? null : String(r.user_id),
        name: r.name === null || r.name === undefined ? null : String(r.name),
        role: String(r.role),
        invited_at: num(r.invited_at),
      }));
    },

    async removeMember(boardId, target) {
      if (target.userId) {
        await q(`DELETE FROM board_members WHERE board_id = $1 AND user_id = $2`, [boardId, target.userId]);
      } else if (target.email) {
        await q(`DELETE FROM board_members WHERE board_id = $1 AND email = $2`, [
          boardId,
          target.email.toLowerCase(),
        ]);
      }
    },
  };

  return store;
}
