import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HTTP } from '@forgea/types';
import type { BrowserContext } from '@playwright/test';

/**
 * Signs the browser in as the local admin on the test database, the way `pnpm dashboard`
 * does (staff normally sign in with Google, which tests can't use).
 */
export async function signInAsAdmin(context: BrowserContext, baseURL: string) {
  const api = fileURLToPath(new URL('../../api/', import.meta.url));
  const session = JSON.parse(
    execFileSync(process.execPath, ['scripts/dev-admin-session.ts'], {
      cwd: api,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: process.env['TEST_DATABASE_URL'] },
    }),
  ) as { access: string; refresh: string };
  await context.addCookies(
    [
      [HTTP.ACCESS_COOKIE, session.access],
      [HTTP.REFRESH_COOKIE, session.refresh],
    ].map(([name, value]) => ({
      name: name!,
      value: value!,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Strict' as const,
    })),
  );
}
