import { type PendingConfirmation, safeNext } from '@forgea/types';
import { createCookie, redirect } from 'react-router';
import { serverEnv } from '~/lib/env.server';

/**
 * Between "create account" (or a sign-in that still needs confirming) and entering the emailed
 * code, the browser keeps the API's ticket here: httpOnly, for as long as the ticket is valid.
 * The ticket signs nobody in by itself; only with the code.
 */
const pendingCookie = () =>
  createCookie('forgea_pending', {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverEnv().PUBLIC_WEB_URL.startsWith('https:'),
    // '/', not '/verify-email': client navigations fetch /verify-email.data, outside that path.
    path: '/',
    maxAge: 15 * 60,
  });

export interface Pending extends PendingConfirmation {
  /** Where to go once confirmed (already checked by safeNext). */
  next: string;
}

export async function readPending(request: Request): Promise<Pending | null> {
  const value: unknown = await pendingCookie().parse(
    request.headers.get('Cookie'),
  );
  if (typeof value !== 'object' || value === null) return null;
  const { ticket, email, next } = value as Record<string, unknown>;
  return typeof ticket === 'string' && typeof email === 'string'
    ? { ticket, email, next: safeNext(typeof next === 'string' ? next : null) }
    : null;
}

/** On to the code page, holding the ticket. */
export async function toCodePage(
  pending: PendingConfirmation,
  next: string,
): Promise<Response> {
  return redirect('/verify-email', {
    headers: {
      'Set-Cookie': await pendingCookie().serialize({
        ticket: pending.ticket,
        email: pending.email,
        next,
      }),
    },
  });
}

/** Done (or abandoned): forget the ticket. */
export function clearPending(): Promise<string> {
  return pendingCookie().serialize('', { maxAge: 0 });
}
