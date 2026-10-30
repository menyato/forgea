import { expect, test as base } from '@playwright/test';

export { expect };

/**
 * Every test is its own visitor: a distinct IP in Cloudflare's header (as production
 * receives it), so the API's per-visitor rate limits treat tests as separate people.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    const n = () => Math.floor(Math.random() * 254) + 1;
    // 198.18.0.0/15 is reserved for benchmark tests: never a real visitor.
    await context.setExtraHTTPHeaders({
      'cf-connecting-ip': `198.18.${n()}.${n()}`,
    });
    await use(context);
  },
});

/**
 * The dashboard menu, opened first on a phone (there it starts closed, over the page; on a
 * wide screen it is already beside the page).
 */
export async function dashboardMenu(page: import('@playwright/test').Page) {
  const menu = page.getByRole('navigation', { name: 'Dashboard' });
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const show = page.getByRole('button', { name: 'Show the menu' });
    // A tap before the page's script has loaded does nothing: tap until it opens.
    await expect(async () => {
      if (!(await menu.isVisible())) await show.click();
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }).toPass();
  }
  return menu;
}

/** On a phone, closes the dashboard menu so the page under it can be used. */
export async function closeDashboardMenu(
  page: import('@playwright/test').Page,
) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) return;
  const menu = page.getByRole('navigation', { name: 'Dashboard' });
  if (await menu.isVisible()) {
    await page.getByRole('button', { name: 'Hide the menu' }).click();
    await expect(menu).toBeHidden();
  }
}
