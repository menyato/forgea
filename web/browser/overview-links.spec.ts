import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'The Overview: one run is enough');

/** Lists show 50 to a page: a bigger number fills the first page. */
const PAGE = 50;

test('every Overview number opens a list showing exactly that many', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin');
  const cards = page.locator('#main a[href^="/admin/"]:has(span.text-3xl)');
  await expect(cards.first()).toBeVisible();
  const targets = await cards.evaluateAll((links) =>
    links.map((a) => ({
      href: a.getAttribute('href')!,
      label: a.querySelector('.text-sm')?.textContent ?? '',
    })),
  );
  expect(targets.length).toBeGreaterThan(8);

  for (const { href, label } of targets) {
    // Other tests add records meanwhile: the card and its list are read again until they agree.
    await expect(async () => {
      await page.goto('/admin');
      const card = page.locator(`#main a[href="${href}"]:has(span.text-3xl)`);
      const count = Number(await card.locator('span.text-3xl').textContent());
      // As a list (some open as a board), where the rows can be counted.
      await page.goto(`${href}${href.includes('?') ? '&' : '?'}view=list`);
      const rows = await page.locator('#main table tbody tr:has(td)').count();
      expect(rows, `${label} → ${href}`).toBe(Math.min(count, PAGE));
    }).toPass({ timeout: 30_000 });
  }
});
