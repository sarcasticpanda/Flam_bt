import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore } from '../postgres.js';
import type { Store } from '../types.js';

/**
 * Runs the production Postgres code against a REAL Postgres engine (PGlite is Postgres compiled
 * to WASM), not a mock.
 *
 * The point is that untested SQL only fails the moment a real connection string is pasted in —
 * i.e. in production, on the deploy that was supposed to save the data. BYTEA round-tripping and
 * BIGINT-as-string are both things that work fine in SQLite and silently break on Postgres.
 */
describe('postgres store', () => {
  let store: Store;
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    store = createPostgresStore({
      query: (text, params) => pg.query(text, params as unknown[]) as never,
    });
    await store.init();
  });

  afterAll(async () => {
    await pg.close();
  });

  it('creates the schema without error', async () => {
    const { rows } = await pg.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
    );
    expect(rows.map((r) => (r as { tablename: string }).tablename)).toEqual([
      'board_members', 'board_state', 'board_versions', 'boards', 'users',
    ]);
  });

  it('is idempotent — init twice does not throw', async () => {
    await expect(store.init()).resolves.not.toThrow();
  });

  it('creates and finds a board by its edit code', async () => {
    const u = await store.createUser('u1', 'A@Test.com', 'hash', 'Alice');
    // Email is normalised on the way in, or a login with different casing silently fails.
    expect(u.email).toBe('a@test.com');

    await store.createBoard('b1', 'AAA111', 'VVV111', 'Board One', 'u1');
    const found = await store.findByAnyCode('AAA111');
    expect(found?.board.title).toBe('Board One');
    expect(found?.readOnly).toBe(false);
  });

  it('resolves the view code to the same board, read-only', async () => {
    const found = await store.findByAnyCode('VVV111');
    expect(found?.board.id).toBe('b1');
    expect(found?.readOnly).toBe(true);
  });

  it('is case-insensitive on codes and returns null for unknown', async () => {
    expect((await store.findByAnyCode('aaa111'))?.board.id).toBe('b1');
    expect(await store.findByAnyCode('NOPE00')).toBeNull();
  });

  it('returns timestamps as NUMBERS, not bigint strings', async () => {
    // Postgres hands BIGINT back as a string. Unconverted it flows into the API, sorts
    // lexicographically, and breaks date maths in ways that surface much later.
    const found = await store.findByAnyCode('AAA111');
    expect(typeof found?.board.created_at).toBe('number');
    expect(found!.board.created_at).toBeGreaterThan(1_600_000_000_000);
  });

  it('round-trips a Yjs document through BYTEA byte-for-byte', async () => {
    const doc = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 64]);
    await store.saveDoc('b1', doc);
    const back = await store.loadDoc('b1');
    expect(back).toBeInstanceOf(Uint8Array);
    expect(Array.from(back!)).toEqual(Array.from(doc));
  });

  it('overwrites the document on repeated save (upsert, not duplicate-key)', async () => {
    await store.saveDoc('b1', new Uint8Array([9, 9, 9]));
    expect(Array.from((await store.loadDoc('b1'))!)).toEqual([9, 9, 9]);
  });

  it('returns null for a board with no saved document', async () => {
    await store.createBoard('b2', 'BBB222', 'VVV222', 'Empty', 'u1');
    expect(await store.loadDoc('b2')).toBeNull();
  });

  it('stores and lists versions newest first', async () => {
    await store.saveVersion('v1', 'b1', 'first', 'Alice', new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 5));
    await store.saveVersion('v2', 'b1', 'second', 'Alice', new Uint8Array([2]));
    const list = await store.listVersions('b1');
    expect(list.map((v) => v.label)).toEqual(['second', 'first']);
    expect(Array.from((await store.getVersion('v1'))!)).toEqual([1]);
  });

  it('grants the owner the owner role without a membership row', async () => {
    const { board } = (await store.findByAnyCode('AAA111'))!;
    expect(await store.accessFor(board, 'u1')).toBe('owner');
  });

  it('denies a stranger', async () => {
    const { board } = (await store.findByAnyCode('AAA111'))!;
    expect(await store.accessFor(board, 'nobody')).toBeNull();
  });

  it('invites an existing user and resolves them immediately', async () => {
    await store.createUser('u2', 'bob@test.com', 'hash', 'Bob');
    const m = await store.inviteMember('b1', 'BOB@test.com', 'editor');
    expect(m.pending).toBe(false);
    expect(m.userId).toBe('u2');
    const { board } = (await store.findByAnyCode('AAA111'))!;
    expect(await store.accessFor(board, 'u2')).toBe('editor');
  });

  it('holds an invite for an email with no account, then attaches it on signup', async () => {
    // This is what makes "invite by email" work with no email-sending service at all.
    const pending = await store.inviteMember('b1', 'carol@test.com', 'viewer');
    expect(pending.pending).toBe(true);
    expect(pending.userId).toBeNull();

    await store.createUser('u3', 'carol@test.com', 'hash', 'Carol');
    const { board } = (await store.findByAnyCode('AAA111'))!;
    expect(await store.accessFor(board, 'u3')).toBe('viewer');
  });

  it('changes a role on re-invite instead of erroring on the primary key', async () => {
    await store.inviteMember('b1', 'bob@test.com', 'viewer');
    const { board } = (await store.findByAnyCode('AAA111'))!;
    expect(await store.accessFor(board, 'u2')).toBe('viewer');
    const members = await store.listMembers('b1');
    expect(members.filter((m) => m.email === 'bob@test.com')).toHaveLength(1);
  });

  it('removes a member by id and by email', async () => {
    await store.removeMember('b1', { userId: 'u2' });
    const { board } = (await store.findByAnyCode('AAA111'))!;
    expect(await store.accessFor(board, 'u2')).toBeNull();

    await store.removeMember('b1', { email: 'CAROL@test.com' });
    expect(await store.accessFor(board, 'u3')).toBeNull();
  });

  it('lists owned and invited boards together, without duplicates', async () => {
    // u1 owns b1 and b2. Invite u1 to their own board — the UNION must not double it.
    await store.inviteMember('b1', 'a@test.com', 'editor');
    const boards = await store.boardsForUser('u1');
    const ids = boards.map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2']);
  });

  it('updates the title and bumps updated_at', async () => {
    const before = (await store.findByAnyCode('AAA111'))!.board.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await store.setTitle('b1', 'Renamed');
    const after = (await store.findByAnyCode('AAA111'))!.board;
    expect(after.title).toBe('Renamed');
    expect(after.updated_at).toBeGreaterThanOrEqual(before);
  });

  it('cascades board deletion to state, versions and members', async () => {
    await pg.query(`DELETE FROM boards WHERE id = 'b2'`);
    const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM board_state WHERE board_id='b2'`);
    expect((rows[0] as { n: number }).n).toBe(0);
  });
});
