import type { Page } from '@playwright/test';
import { signInAsAdmin } from './admin-session';
import { recordPages } from './record-pages';
import { expect, test } from './fixtures';

/**
 * Text, buttons and fields that stick out of the box they sit in (a panel, a card, a bordered
 * row), and pages wider than the screen: on every page, at the size each run uses (desktop
 * and phone). Scrolling areas (a wide table in its own scroll box) are fine; what spills
 * over a border is not.
 */
async function overflows(page: Page, paths: readonly string[]) {
  const problems: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) {
        out.push(
          `the page is ${doc.scrollWidth - window.innerWidth}px wider than the screen`,
        );
      }
      const bordered = (el: Element) => {
        const s = getComputedStyle(el);
        return (
          parseFloat(s.borderLeftWidth) > 0 &&
          parseFloat(s.borderRightWidth) > 0
        );
      };
      const clips = (el: Element) => {
        const s = getComputedStyle(el);
        return s.overflowX !== 'visible' || s.position === 'fixed';
      };
      const items = document.querySelectorAll(
        '#main :is(input, select, textarea, button, a, label, span, p, strong, h1, h2, h3, legend, td, th)',
      );
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue; // hidden or screen-reader only
        let box: Element | null = el.parentElement;
        let scrolls = false;
        while (box && box !== document.body) {
          if (clips(box)) {
            scrolls = true;
            break;
          }
          if (bordered(box)) break;
          box = box.parentElement;
        }
        if (scrolls || !box || box === document.body) continue;
        const b = box.getBoundingClientRect();
        const over = Math.max(r.right - b.right, b.left - r.left);
        if (over > 1) {
          const text = (el.textContent ?? '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 40);
          out.push(
            `<${el.tagName.toLowerCase()}> "${text}" sticks out of its box by ${Math.round(over)}px`,
          );
        }
      }
      return [...new Set(out)];
    });
    problems.push(...found.map((f) => `${path}: ${f}`));
  }
  return problems;
}

const SHOP = [
  '/',
  '/shop',
  '/products/phone-stand',
  '/products/name-keychain',
  '/products/curved-initials',
  '/products/baby-initial-name',
  '/products/couple-names',
  '/products/twist-vase',
  '/custom',
  '/contact',
  '/privacy',
  '/cart',
  '/sign-in',
  '/register',
] as const;

const DASHBOARD = [
  '/admin',
  '/admin/orders',
  '/admin/orders?view=kanban',
  '/admin/production',
  '/admin/requests',
  '/admin/customers',
  '/admin/backups',
  '/admin/leads',
  '/admin/leads?view=list&group=stage',
  '/admin/leads/new',
  '/admin/orders?group=status',
  '/admin/quotations',
  '/admin/quotations/new',
  '/admin/accounting',
  '/admin/accounting/books',
  '/admin/accounting/reports',
  '/admin/insights',
  '/admin/insights?from=2026-01-01&to=2026-10-31',
  '/admin/products',
  '/admin/products/new',
  '/admin/fonts',
  '/admin/home-plate',
  '/admin/categories',
  '/admin/options',
  '/admin/materials',
  '/admin/stock',
  '/admin/lead-stages',
  '/admin/lead-stages/new',
  '/admin/lost-reasons',
  '/admin/lost-reasons/new',
  '/admin/materials/new',
  '/admin/materials?view=kanban',
  '/admin/categories/new',
  '/admin/categories?view=kanban',
  '/admin/options/new',
  '/admin/options?view=kanban',
  '/admin/fonts/new',
  '/admin/fonts?view=kanban',
  '/admin/stock?view=kanban',
  '/admin/stock/movements',
  '/admin/stock/receive',
  '/admin/stock/print',
  '/admin/stock/failed',
  '/admin/stock/weigh',
  '/admin/production?view=list',
  '/admin/production/new',
  '/admin/production/calendar',
  '/admin/printers',
  '/admin/printers/new',
  '/admin/accounting/books/entries/new',
  '/admin/team/new',
  '/admin/team?filter=customers',
  '/admin/products?view=kanban',
  '/admin/quotations?view=kanban',
  '/admin/requests?view=kanban',
  '/admin/pricing',
  '/admin/currencies',
  '/admin/currencies/new',
  '/admin/theme',
  '/admin/team',
  '/admin/permissions',
  '/admin/catalog',
  '/admin/audit',
  '/admin/settings',
] as const;

test('nothing on the shop pages spills out of its box', async ({ page }) => {
  test.setTimeout(120_000);
  expect(await overflows(page, SHOP)).toEqual([]);
});

test('nothing on the dashboard pages spills out of its box', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(600_000);
  await signInAsAdmin(context, baseURL!);
  // An existing product shows the option and size set-up filled in.
  const paths = [...DASHBOARD];
  await page.goto('/admin/products?q=Phone%20stand');
  const edit = await page
    .getByRole('link', { name: 'Phone stand', exact: true })
    .first()
    .getAttribute('href');
  if (edit) paths.push(edit as (typeof DASHBOARD)[number]);
  // And a record's form from every list.
  const records = await recordPages(page);
  expect(await overflows(page, [...paths, ...records])).toEqual([]);
});
