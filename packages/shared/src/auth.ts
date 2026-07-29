/**
 * Accounts and board membership.
 *
 * Layered ON TOP of the anonymous-by-code flow, never replacing it. A board created without an
 * account still works exactly as before (`owner_id` null); logging in adds ownership, a
 * server-side board list, and invite/remove controls for boards you own. Requiring an account
 * to draw would make the assignment's actual demo worse, not better.
 */
import { z } from 'zod';

export const BOARD_ROLES = ['owner', 'editor', 'viewer'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface BoardMember {
  userId: string | null;
  /** Kept even after the invite resolves, so "invited by" history survives. */
  email: string;
  name: string | null;
  role: BoardRole;
  /** True until someone with a matching email account logs in. */
  pending: boolean;
  invitedAt: number;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const emailSchema = z.string().trim().toLowerCase().email().max(200);
// Long enough to matter, short enough not to reject a real password over an arbitrary cap.
const passwordSchema = z.string().min(8).max(200);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['editor', 'viewer']).default('editor'),
});

export interface AuthResponse {
  token: string;
  user: PublicUser;
}
