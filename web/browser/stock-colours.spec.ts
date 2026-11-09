import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test('a special filament colour is entered with how it looks, and the shelf shows it in that colour', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const colour = `Galaxy ${Date.now().toString(36)}`;
  await page.goto('/admin/stock/receive');
  const record = page.getByRole('region', { name: 'Record' });
  await record.getByLabel('Material').selectOption({ label: 'PLA (PLA)' });
  await record.getByLabel('Spools').fill('1');
  await record.getByLabel('Each spool holds').selectOption('1000');
  await record.getByLabel('Or a new colour').fill(colour);
  // A new colour gets its own look, picked as RGB.
  await record.getByLabel('How it looks').fill('#3b2a6e');
  await expect(record.getByText('#3b2a6e')).toBeVisible();
  await record.getByLabel('Price of one spool (USD)').fill('22.00');
  await record.getByRole('button', { name: 'Add to the shelf' }).click();
  await expect(record.getByText('Saved')).toBeVisible();

  await page.goto(`/admin/stock?q=${encodeURIComponent(colour)}`);
  const row = page.getByRole('row').filter({ hasText: colour });
  await expect(row).toHaveCount(1);
  await expect(row.locator('span[aria-hidden]').first()).toHaveCSS(
    'background-color',
    'rgb(59, 42, 110)',
  );
});
