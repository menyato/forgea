import type { Page } from '@playwright/test';
import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

/**
 * What Chrome's DevTools would complain about, on every page: its "Issues" panel (forms,
 * cookies, content security…), console errors, uncaught errors, and form fields that have no
 * id/name or no autocomplete value. Any of these fails the test with the page and the element.
 */
async function audit(page: Page, paths: readonly string[]) {
  const problems: string[] = [];
  let where = '';
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Audits.issueAdded', ({ issue }) => {
    problems.push(
      `${where}: DevTools issue ${issue.code} ${JSON.stringify(issue.details).slice(0, 300)}`,
    );
  });
  await cdp.send('Audits.enable');
  page.on('console', (m) => {
    if (m.type() === 'error')
      problems.push(`${where}: console error ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => problems.push(`${where}: uncaught ${e.message}`));

  for (const path of paths) {
    where = path;
    const response = await page.goto(path);
    if (!response || response.status() >= 400) {
      problems.push(`${path}: status ${response?.status()}`);
      continue;
    }
    // Let lazy parts (3D, client-only widgets) render before looking.
    await page.waitForLoadState('networkidle');
    const fields = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter(
          (el) =>
            !['hidden', 'submit', 'button', 'reset', 'image'].includes(
              (el as HTMLInputElement).type,
            ),
        )
        .flatMap((el) => {
          const missing = [
            ...(!el.id && !el.getAttribute('name') ? ['id or name'] : []),
            // Like Chrome: only fields autofill could fill need to say whether it may.
            ...(!el.hasAttribute('autocomplete') &&
            !['checkbox', 'radio', 'file', 'color', 'range'].includes(
              (el as HTMLInputElement).type,
            )
              ? ['autocomplete']
              : []),
          ];
          return missing.length
            ? [
                `<${el.tagName.toLowerCase()} ${el.outerHTML.slice(0, 140)}> lacks ${missing.join(' and ')}`,
              ]
            : [];
        }),
    );
    problems.push(...fields.map((f) => `${path}: ${f}`));
  }
  return problems;
}

const PUBLIC = [
  '/',
  '/shop',
  '/products/phone-stand',
  '/custom',
  '/contact',
  '/cart',
  '/sign-in',
  '/register',
  '/forgot-password',
] as const;

const DASHBOARD = [
  '/admin',
  '/admin/orders',
  '/admin/production',
  '/admin/requests',
  '/admin/leads',
  '/admin/quotations',
  '/admin/quotations/new',
  '/admin/accounting',
  '/admin/accounting/books',
  '/admin/accounting/reports',
  '/admin/products',
  '/admin/products/new',
  '/admin/home-plate',
  '/admin/categories',
  '/admin/options',
  '/admin/materials',
  '/admin/pipeline',
  '/admin/pricing',
  '/admin/currencies',
  '/admin/theme',
  '/admin/team',
  '/admin/permissions',
  '/admin/catalog',
  '/admin/audit',
  '/admin/settings',
] as const;

test('the shop pages have nothing for DevTools to flag', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the same markup on both sizes',
  );
  expect(await audit(page, PUBLIC)).toEqual([]);
});

test('the dashboard pages have nothing for DevTools to flag', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the same markup on both sizes',
  );
  test.setTimeout(180_000);
  await signInAsAdmin(context, baseURL!);
  expect(await audit(page, DASHBOARD)).toEqual([]);
});
