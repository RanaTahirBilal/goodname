/**
 * The small primitives both authentication paths share.
 *
 * Extracted rather than copied. Customer sign-in and staff sign-in have
 * deliberately different rules, but they must not have different *hashing* —
 * a second, slightly-drifted copy of this is how one of them quietly ends up
 * storing something usable.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Tokens are 32 random bytes and codes are drawn from a CSPRNG, so a plain
 * SHA-256 is right here: there is nothing to brute-force offline the way
 * there is with a human-chosen password, and a slow KDF would only cost
 * latency on every request.
 */
export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const constantTimeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export const plusSeconds = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString();
