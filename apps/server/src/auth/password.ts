import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

/**
 * Password hashing via scrypt — built into Node, no bcrypt/argon2 dependency to install.
 * scrypt is deliberately memory-hard, which is the property that matters against GPU cracking.
 *
 * Stored as `salt:hash`, both hex. A fresh random salt per password means two identical
 * passwords never produce the same stored value, which is what makes a leaked hash table
 * useless against rainbow tables.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;

  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');

  // timingSafeEqual throws on length mismatch rather than returning false, and a corrupted
  // stored hash must fail closed, not crash the request.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
