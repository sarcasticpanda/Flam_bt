import { Router } from 'express';
import { customAlphabet } from 'nanoid';
import { loginSchema, signupSchema, type AuthResponse, type PublicUser } from '@board/shared';
import { store } from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { requireAuth, signToken } from '../auth/jwt.js';

export const authRouter = Router();
const nanoId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);

function toPublicUser(u: { id: string; email: string; name: string; created_at: number }): PublicUser {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

authRouter.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_input',
      message: parsed.error.issues[0]?.message ?? 'Check your name, email, and password.',
    });
    return;
  }
  const { email, password, name } = parsed.data;

  if (await store.userByEmail(email)) {
    // Deliberately specific: "that email is taken" is more useful than a generic failure, and
    // this is a signup form, not a login form — it does not leak whether a stranger has an
    // account the way the same message would on a login endpoint.
    res.status(409).json({ error: 'email_taken', message: 'An account with that email already exists.' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await store.createUser(nanoId(), email, passwordHash, name);
  const token = signToken({ sub: user.id, email: user.email, name: user.name });

  const body: AuthResponse = { token, user: toPublicUser(user) };
  res.status(201).json(body);
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Enter your email and password.' });
    return;
  }
  const { email, password } = parsed.data;

  const user = await store.userByEmail(email);
  // Same message whether the email is unknown or the password is wrong — telling them apart
  // would let an attacker enumerate which emails have accounts.
  const message = 'That email and password do not match.';

  if (!user) {
    res.status(401).json({ error: 'invalid_credentials', message });
    return;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials', message });
    return;
  }

  const token = signToken({ sub: user.id, email: user.email, name: user.name });
  const body: AuthResponse = { token, user: toPublicUser(user) };
  res.json(body);
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await store.userById(req.user!.sub);
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'Session no longer valid.' });
    return;
  }
  res.json({ user: toPublicUser(user) });
});
