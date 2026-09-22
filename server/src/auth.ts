/**
 * Authentication: password hashing and stateless session tokens.
 *
 * Implemented on `node:crypto` rather than `bcrypt` + `jsonwebtoken` so the backend
 * runs with zero installed dependencies. The token format is a standard JWT
 * (HS256, base64url segments), so it can be swapped for the `jsonwebtoken` library
 * without touching callers.
 *
 * Passwords use scrypt, which is memory-hard and included in Node's crypto module.
 * Verification is constant-time.
 */

import crypto from 'node:crypto';
import { config } from './config.ts';

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;

  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  // timingSafeEqual throws on a length mismatch, so guard first.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Randomised when JWT_SECRET is unset. A fresh secret per boot means restarting the
 * server logs everyone out, which is the right trade for a prototype: no weak default
 * secret can ever ship.
 */
const secret = config.jwtSecret ?? crypto.randomBytes(32).toString('hex');

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

const sign = (data: string): string =>
  crypto.createHmac('sha256', secret).update(data).digest('base64url');

export interface TokenPayload {
  sub: number;
  name: string;
  email: string;
  role: 'admin' | 'technician';
  iat: number;
  exp: number;
}

export function issueToken(user: {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'technician';
}): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + config.tokenTtlSeconds,
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** Verify a token. Returns `null` for anything malformed, mis-signed, or expired. */
export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
