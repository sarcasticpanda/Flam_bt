import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Environment loading, isolated into its own module and imported FIRST in index.ts.
 *
 * Two things make this necessary rather than a one-liner:
 *
 *  1. `dotenv/config` resolves .env from the process CWD, which is apps/server — but the .env
 *     lives at the REPO ROOT so a single file serves the whole workspace.
 *  2. ES module imports are evaluated depth-first in source order, and routes/ai.ts builds its
 *     provider chain at module scope. Calling dotenv inside index.ts would run AFTER that
 *     module had already read an empty process.env, silently collapsing the chain to demo-only.
 *     That reads as "the AI is broken" rather than "the key never loaded".
 */

const here = dirname(fileURLToPath(import.meta.url));

loadEnv({ path: resolve(here, '../../../.env') });
// A platform-provided environment (Render, Fly, Docker) always wins over the local file.
loadEnv();

export const ENV = {
  PORT: Number(process.env.PORT ?? 3001),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? '*',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
};

const configured = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'].filter(
  (k) => process.env[k],
);
console.log(`[env] loaded — ${configured.length} AI key(s) present`);
