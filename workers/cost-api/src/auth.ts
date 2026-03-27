import type { Env } from './types.ts';

/**
 * Compares two strings in constant time to prevent timing-based token leaks.
 * Returns false immediately if lengths differ (lengths are not secret).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Validates the `Authorization: Bearer <token>` header against the
 * `COST_API_TOKEN` Worker secret.
 *
 * Returns `true` if the token is present and matches; `false` otherwise.
 */
export function authenticate(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match) return false;

  const token = match[1];
  if (!token) return false;

  return timingSafeEqual(token, env.COST_API_TOKEN);
}
