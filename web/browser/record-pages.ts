import type { Page } from '@playwright/test';

/**
 * The lists whose records have no fixed address (their forms are `/<list>/<id>`): each
 * filtered to show everything, so the first row is there whenever the test data has one.
 */
const LISTS = [
  '/admin/orders?filter=',
  '/admin/leads?view=list&filter=',
  '/admin/quotations',
  '/admin/requests?filter=',
  '/admin/products',
  '/admin/materials?filter=',
  '/admin/categories?filter=',
  '/admin/options?filter=',
  '/admin/fonts?filter=',
  '/admin/lead-stages?filter=',
  '/admin/lost-reasons?filter=',
  '/admin/currencies',
  '/admin/team',
  '/admin/stock?filter=',
  '/admin/production?view=list&filter=',
  '/admin/accounting?filter=',
  '/admin/accounting/books?filter=',
  '/admin/audit',
];

/** One record's form from each list: the first row's link (none when the list is empty). */
export async function recordPages(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const list of LISTS) {
    await page.goto(list);
    const href = await page
      .locator('table tbody a')
      .first()
      .getAttribute('href', { timeout: 3_000 })
      .catch(() => null);
    if (href) found.push(href);
  }
  return found;
}
