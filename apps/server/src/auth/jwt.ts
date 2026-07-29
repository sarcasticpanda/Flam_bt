import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Request, Response, NextFunction } from 'express';

export interface AuthTokenPayload {
  sub: string; // userId
  email: string;
  name: string;
}

const SECRET = process.env.JWT_SECRET;

if (!SECRET && process.env.NODE_ENV === 'production') {
  // Refuse to boot rather than silently issuing forgeable tokens. A deployment that starts
  // without a secret is strictly worse than one that fails loudly: it looks healthy while
  // every account on it is open.
  throw new Error(
    'JWT_SECRET must be set in production. Generate one with: openssl rand -base64 32',
  );
}

/**
 * Dev fallback: a RANDOM secret, generated once and cached in a gitignored file.
 *
 * Never a hardcoded constant. A literal committed here is a published signing key — anyone can
 * mint a token for any user id, and user ids are not secret (they ride on Yjs awareness to every
 * peer on a board). That was a real, verified account-impersonation bypass, not a theoretical one.
 *
 * Caching to disk rather than regenerating per boot keeps local sessions alive across the
 * restarts that `tsx watch` does constantly, while still never putting the value in the repo.
 */
function devSecret(): string {
  const file = resolve(process.env.SQLITE_PATH ? dirname(process.env.SQLITE_PATH) : './data', '.dev-jwt-secret');
  try {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    const generated = randomBytes(32).toString('hex');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    return generated;
  } catch {
    // Read-only filesystem: fall back to per-boot. Sessions reset on restart, which is
    // strictly better than a shared known value.
    return randomBytes(32).toString('hex');
  }
}

const EFFECTIVE_SECRET = SECRET ?? devSecret();

if (!SECRET) {
  console.warn('[auth] JWT_SECRET not set — using a local dev secret from ./data/.dev-jwt-secret');
}

const EXPIRY = '30d';

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, EFFECTIVE_SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, EFFECTIVE_SECRET) as AuthTokenPayload;
  } catch {
    return null;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

/** Attaches req.user if a valid token is present. Never rejects — most routes work either way. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

/** Rejects with 401 if there is no valid token. Used only on routes that require an account. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'unauthorized', message: 'Sign in to do that.' });
    return;
  }
  req.user = payload;
  next();
}
