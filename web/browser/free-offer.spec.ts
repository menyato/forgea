import { signInAsAdmin } from './admin-session';
import { expect, newVisitor, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'One run is enough');

test('the owner runs a free offer; a visitor sees the banner, claims the piece and finds it free in the cart', async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  await signInAsAdmin(context, baseURL!);
  const title = `Free stand ${Date.now().toString(36)}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  // datetime-local in the studio's time (Beirut); a few minutes either side is plenty.
  const beirut = (ms: number) => {
    const d = new Date(
      new Date(Date.now() + ms).toLocaleString('en-US', {
        timeZone: 'Asia/Beirut',
      }),
    );
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  await page.goto('/admin/offers/new');
  const piece = page.getByLabel('Piece given');
  const product = await piece
    .locator('option:not([disabled])')
    .filter({ hasText: 'Phone stand' })
    .first()
    .textContent();
  await piece.selectOption({ label: product!.trim() });
  await page.getByLabel('What the banner says').fill(title);
  await page.getByLabel(/Starts/).fill(beirut(-3_600_000));
  // Ending soonest, so it is the one the shop shows (a retry's sooner than the try before it,
  // which may still be running).
  await page
    .getByLabel(/Ends/)
    .fill(beirut((30 - 5 * testInfo.retry) * 60_000));
  await page.getByLabel(/How many to give/).fill('5');
  await page.getByRole('button', { name: 'Add offer' }).click();
  await expect(page).toHaveURL(/\/admin\/offers\/[0-9a-f-]{36}$/);

  const visitor = await (await newVisitor(browser)).newPage();
  await visitor.goto('/shop');
  const banner = visitor.getByRole('complementary', { name: 'Free offer' });
  // The shop keeps its shared reads 10 s (api.shared()): the new offer shows within that.
  await expect(banner).toContainText(title, { timeout: 15_000 });
  await expect(banner).toContainText('5 to give');
  await banner.getByRole('link', { name: 'Claim yours' }).click();
  await expect(visitor).toHaveURL(/\/products\//);
  await visitor.getByRole('button', { name: 'Claim it free' }).click();
  await expect(
    visitor.getByRole('button', { name: 'Claimed: it is in your cart' }),
  ).toBeVisible();
  await visitor.goto('/cart');
  await expect(visitor.getByText('Free (limited time offer)')).toBeVisible();
  await expect(visitor.getByText('One per customer')).toBeVisible();

  // Switched off: the banner goes at once.
  await page.getByLabel('Running').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await visitor.goto('/shop');
  await expect(
    visitor.getByRole('complementary', { name: 'Free offer' }),
  ).toHaveCount(0);
});
