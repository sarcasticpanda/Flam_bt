import type { Store } from './types.js';
import { createSqliteStore } from './sqlite.js';
import { createPostgresStore } from './postgres.js';

export type { BoardRow, MemberRow, Store, UserRow, VersionRow } from './types.js';
export { isOwner } from './types.js';

/**
 * Pick a backend from the environment.
 *
 *   DATABASE_URL set   -> Postgres (Neon, Supabase, Railway, or any Postgres)
 *   otherwise          -> SQLite at SQLITE_PATH, local development only
 *
 * Production REFUSES to fall back to SQLite. Free hosting tiers have ephemeral disks, so a
 * SQLite file there is deleted on every redeploy along with every account on it — and it fails
 * silently, looking like the app simply forgot everyone. Better to refuse to boot.
 */
async function connect(): Promise<Store> {
  const url = process.env.DATABASE_URL?.trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (url) {
    // Imported lazily so local development never has to resolve the pg driver.
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: url,
      // Hosted Postgres (Neon, Supabase, Render) terminates TLS at the proxy with a certificate
      // Node will not chain to a root CA. Verification is skipped only for those hosts, and only
      // when the URL does not already say sslmode=disable (which is how you run a local Postgres).
      ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    const store = createPostgresStore(pool);
    try {
      await store.init();
    } catch (err) {
      // A wrong or unreachable DATABASE_URL otherwise surfaces as a raw ECONNREFUSED stack
      // trace, which says nothing about which setting is wrong. This is the single most likely
      // thing to go wrong on a first deploy, so name it.
      // node-postgres surfaces DNS/TCP failures as an AggregateError whose own `message` is
      // empty — the useful text is on the nested errors, so reach in for it.
      const detail =
        err instanceof AggregateError
          ? [...new Set(err.errors.map((e) => (e as Error)?.message ?? String(e)))].join('; ')
          : err instanceof Error
            ? err.message
            : String(err);
      const host = url.replace(/\/\/[^@]*@/, '//***@');
      throw new Error(
        `Could not connect to the database.\n` +
          `  DATABASE_URL: ${host}\n` +
          `  Reason: ${detail}\n` +
          `  Check the connection string is complete (Neon includes ?sslmode=require), that the ` +
          `project is not suspended, and that the password has no unescaped characters.`,
      );
    }
    console.log('[db] postgres connected');
    return store;
  }

  if (isProd) {
    throw new Error(
      'DATABASE_URL is required in production. SQLite on an ephemeral disk loses every ' +
        'account and board on redeploy. Create a free Postgres at neon.tech and set DATABASE_URL.',
    );
  }

  const path = process.env.SQLITE_PATH ?? './data/board.db';
  const store = createSqliteStore(path);
  await store.init();
  console.log(`[db] sqlite at ${path} (development only)`);
  return store;
}

/**
 * The live store, connected at import time via top-level await.
 *
 * Doing it here rather than threading a store instance through every module keeps the migration
 * to Postgres a one-line import change at each call site. ES modules guarantee this resolves
 * before any importer's body runs, so no route can observe a half-initialised store.
 */
export const store: Store = await connect();
