import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export interface AuthTokenPayload {
  sub: string; // userId
  email: string;
  name: string;
}

const SECRET = process.env.JWT_SECRET;

if (!SECRET && process.env.NODE_ENV === 'production') {
  // A missing secret in production means every token is signed with whatever this constant
  // falls back to, which is a well-known value the moment this file is public. Refuse to boot
  // rather than silently issuing forgeable tokens.
  throw new Error('JWT_SECRET must be set in production.');
}

// Dev-only fallback so a fresh clone works without an env file for the anonymous-first flow —
// auth is opt-in, not required to draw.
const EFFECTIVE_SECRET = SECRET ?? 'dev-only-insecure-secret-do-not-deploy';

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
