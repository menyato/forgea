import { safeNext } from '@forgea/types';
import { redirect } from 'react-router';
import type { ApiClient } from '~/lib/api-client.server';
import { serverEnv } from '~/lib/env.server';

// Each takes the loader/action `url` argument: React Router's normalized page URL. The raw
// `request.url` of a client-side navigation is the internal "/checkout.data" one.

/** The page to return to after signing in, from `?next=`. */
export function nextPath(url: URL): string {
  return safeNext(url.searchParams.get('next'));
}

/** Google sign-in on the API; it sends the shopper back to `next` afterwards. */
export function googleSignInUrl(url: URL): string {
  const google = new URL('/auth/google', serverEnv().PUBLIC_API_URL);
  google.searchParams.set('next', nextPath(url));
  return google.href;
}

/** Where to send a signed-out shopper who needs an account for this page. */
export function signInFor(url: URL): string {
  return `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/** A signed-in visitor on the sign-in or sign-up page goes on to `?next=` (the home page). */
export async function leaveIfSignedIn(api: ApiClient, url: URL): Promise<void> {
  if (!api.hasSession) return;
  if ((await api.me()).ok) throw redirect(nextPath(url));
}
