// `pnpm dashboard`: opens Chrome signed in as the local admin, on the dashboard.
// Local development only — see api/scripts/dev-admin-session.ts for the safeguards.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HTTP } from '@forgea/types';
import { chromium } from '@playwright/test';

const web = process.env['WEB_URL'] ?? 'http://localhost:5173';
const api = fileURLToPath(new URL('../../api/', import.meta.url));
const session = JSON.parse(
  // Plain Node (it runs TypeScript): the script must load the same packages as the built API.
  execFileSync(process.execPath, ['scripts/dev-admin-session.ts'], {
    cwd: api,
    encoding: 'utf8',
  }),
) as { email: string; access: string; refresh: string };

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({ viewport: null });
// Same names and flags the API sets on a real sign-in (cookies are per host, not per port).
await context.addCookies(
  [
    [HTTP.ACCESS_COOKIE, session.access],
    [HTTP.REFRESH_COOKIE, session.refresh],
  ].map(([name, value]) => ({
    name: name!,
    value: value!,
    url: web,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  })),
);
const page = await context.newPage();
await page.goto(`${web}/admin`);
console.log(
  `Signed in as ${session.email} — close the Chrome window when you are done.`,
);
await page.waitForEvent('close', { timeout: 0 });
await browser.close();
