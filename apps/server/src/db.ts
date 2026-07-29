import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  CREATE TABLE IF NOT EXISTS boards (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    view_code   TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled board',
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
`);

export interface BoardRow {
  id: string;
  code: string;
  view_code: string;
  title: string;
  created_at: number;
  updated_at: number;
}

const stmts = {
  insertBoard: db.prepare(
    `INSERT INTO boards (id, code, view_code, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
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
};

export const store = {
  createBoard(id: string, code: string, viewCode: string, title: string): BoardRow {
    const now = Date.now();
    stmts.insertBoard.run(id, code, viewCode, title, now, now);
    return { id, code, view_code: viewCode, title, created_at: now, updated_at: now };
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
};

export function closeDb(): void {
  db.close();
}
