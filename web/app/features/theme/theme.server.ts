import { createCookie } from 'react-router';
import { serverEnv } from '~/lib/env.server';
import { isTheme, type Theme } from './theme';

/** Read only by our server, so the first paint already has the right colors (no flash). */
const themeCookie = () =>
  createCookie('forgea_theme', {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverEnv().PUBLIC_WEB_URL.startsWith('https:'),
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

export async function readTheme(request: Request): Promise<Theme> {
  const value: unknown = await themeCookie().parse(
    request.headers.get('Cookie'),
  );
  return isTheme(value) ? value : 'auto';
}

export function saveTheme(theme: Theme): Promise<string> {
  return themeCookie().serialize(theme);
}
