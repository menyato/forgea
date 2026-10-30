import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HTTP } from '@forgea/types';
import type { BrowserContext } from '@playwright/test';

/**
 * Signs the browser in as the local admin on the test database, the way `pnpm dashboard`
 * does (staff normally sign in with Google, which tests can't use).
 */
export async function signInAsAdmin(context: BrowserContext, baseURL: string) {
  await useSession(context, baseURL, run(['scripts/dev-admin-session.ts']));
}

/** A new staff member or designer with the role's permissions, signed in. */
export async function signInAsTeamMember(
  context: BrowserContext,
  baseURL: string,
  role: 'STAFF' | 'DESIGNER',
): Promise<{ id: string; email: string }> {
  const session = run(['scripts/test-team-session.ts', role]);
  await useSession(context, baseURL, session);
  return session;
}

interface Session {
  id: string;
  email: string;
  access: string;
  refresh: string;
}

function run(args: string[]): Session {
  const api = fileURLToPath(new URL('../../api/', import.meta.url));
  return JSON.parse(
    execFileSync(process.execPath, args, {
      cwd: api,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: process.env['TEST_DATABASE_URL'] },
    }),
  ) as Session;
}

async function useSession(
  context: BrowserContext,
  baseURL: string,
  session: Session,
) {
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
