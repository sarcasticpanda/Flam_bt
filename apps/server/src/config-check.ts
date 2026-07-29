import type { Store } from './db/index.js';

/**
 * Startup configuration report.
 *
 * A misconfigured deploy is the most likely way this project breaks in someone else's hands, and
 * the failures are quiet ones: SQLite silently losing accounts on redeploy, `ws://` blocked as
 * mixed content with nothing in the console, CORS set to `*` handing your AI quota to anyone.
 *
 * Printing an explicit verdict at boot turns "it doesn't work" into a line you can read.
 */

export interface ConfigIssue {
  level: 'error' | 'warn' | 'ok';
  key: string;
  message: string;
}

export function checkConfig(store: Store): ConfigIssue[] {
  const isProd = process.env.NODE_ENV === 'production';
  const issues: ConfigIssue[] = [];

  // --- database ---
  if (store.driver === 'postgres') {
    issues.push({ level: 'ok', key: 'DATABASE_URL', message: 'Postgres connected — data survives redeploys' });
  } else if (isProd) {
    issues.push({
      level: 'error',
      key: 'DATABASE_URL',
      message: 'SQLite in production — every redeploy deletes all accounts and boards',
    });
  } else {
    issues.push({ level: 'ok', key: 'DATABASE_URL', message: 'SQLite (local development)' });
  }

  // --- auth ---
  if (process.env.JWT_SECRET) {
    issues.push({ level: 'ok', key: 'JWT_SECRET', message: 'set' });
  } else if (isProd) {
    // Unreachable — jwt.ts throws before this runs. Kept so the report is complete if that
    // guard is ever weakened again, which is exactly how the original bypass was introduced.
    issues.push({ level: 'error', key: 'JWT_SECRET', message: 'MISSING — tokens are forgeable' });
  } else {
    issues.push({ level: 'ok', key: 'JWT_SECRET', message: 'local dev secret (cached)' });
  }

  // --- cors ---
  const origin = process.env.CLIENT_ORIGIN;
  if (isProd && (!origin || origin === '*')) {
    issues.push({
      level: 'warn',
      key: 'CLIENT_ORIGIN',
      message: '"*" — any website can call this API and spend your AI quota',
    });
  } else if (isProd && origin && !origin.startsWith('https://')) {
    issues.push({
      level: 'warn',
      key: 'CLIENT_ORIGIN',
      message: `"${origin}" is not https — the browser will block wss:// from an https page`,
    });
  } else {
    issues.push({ level: 'ok', key: 'CLIENT_ORIGIN', message: origin ?? 'http://localhost:5173' });
  }

  // --- ai providers ---
  const providers = (['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'] as const).filter(
    (k) => process.env[k],
  );
  if (providers.length === 0) {
    issues.push({
      level: 'warn',
      key: 'AI',
      message: 'no provider keys — AI falls back to offline demo output',
    });
  } else {
    issues.push({ level: 'ok', key: 'AI', message: `${providers.length} provider key(s)` });
  }

  return issues;
}

export function printConfig(issues: ConfigIssue[]): void {
  const mark = { ok: '  ok ', warn: 'WARN ', error: 'FAIL ' } as const;
  console.log('[config] ------------------------------------------');
  for (const i of issues) {
    console.log(`[config] ${mark[i.level]} ${i.key.padEnd(14)} ${i.message}`);
  }
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    console.error(
      `[config] ${errors.length} blocking problem(s). See DEPLOY.md.`,
    );
  }
  console.log('[config] ------------------------------------------');
}
