import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

/** Every record list (list and kanban): its filters menu, opened as a person would. */
const LISTS = [
  '/admin/orders',
  '/admin/orders?view=kanban',
  '/admin/production',
  '/admin/production?view=list',
  '/admin/requests',
  '/admin/leads',
  '/admin/leads?view=list',
  '/admin/quotations',
  '/admin/quotations?view=kanban',
  '/admin/customers',
  '/admin/accounting',
  '/admin/accounting/books',
  '/admin/products',
  '/admin/products?view=kanban',
  '/admin/materials',
  '/admin/materials?view=kanban',
  '/admin/categories',
  '/admin/options',
  '/admin/fonts',
  '/admin/stock',
  '/admin/stock?view=kanban',
  '/admin/stock/movements',
  '/admin/lead-stages',
  '/admin/lost-reasons',
  '/admin/team',
  '/admin/audit',
] as const;

test('every list opens its filters menu from anywhere on the search field, shown on top of the page', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await signInAsAdmin(context, baseURL!);
  const problems: string[] = [];
  for (const path of LISTS) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // Lists with nothing to filter or group by (printers, rates) have no menu.
    if ((await page.getByLabel('Filters and grouping').count()) === 0) continue;
    const field = page.getByRole('searchbox').first();
    // A click on the field itself (not only its arrow) opens the menu.
    await field.click();
    const menu = page.getByRole('group', {
      name: 'Filter and group choices',
    });
    if (!(await menu.isVisible())) {
      problems.push(`${path}: the menu does not open from the field`);
      continue;
    }
    const covered = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 30) return 'too small';
      if (r.right > window.innerWidth + 1 || r.left < -1) return 'off screen';
      const spots = [
        [r.left + 12, r.top + 12],
        [r.right - 12, r.top + 12],
        [r.left + r.width / 2, r.top + r.height / 2],
      ] as const;
      for (const [x, y] of spots) {
        if (y > window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit))
          return `covered by <${hit?.tagName.toLowerCase()} class="${String(hit?.className).slice(0, 60)}">`;
      }
      return null;
    });
    if (covered) problems.push(`${path}: the menu is ${covered}`);
    // Typing still searches, and a click elsewhere closes it.
    await page.locator('h1').first().click();
    if (await menu.isVisible())
      problems.push(`${path}: the menu stays open after a click elsewhere`);
  }
  expect(problems).toEqual([]);
});
