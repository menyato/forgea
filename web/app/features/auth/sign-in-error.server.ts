import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '~/lib/env.server';

const GENERIC = "Google sign-in didn't work. Please try again.";

/**
 * The reason Google sign-in failed, as the API worded and signed it; anything unsigned or
 * altered shows a plain message instead (a link can't make the page say something else).
 */
export function signInError(url: URL): string | null {
  const error = url.searchParams.get('error');
  if (!error) return null;
  const sig = url.searchParams.get('sig') ?? '';
  const secret = serverEnv().INTERNAL_PROXY_SECRET;
  if (!secret || error.length > 300) return GENERIC;
  const expected = createHmac('sha256', secret)
    .update(`sign-in-error:${error}`)
    .digest();
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? error
    : GENERIC;
}
