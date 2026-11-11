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
  await record.getByLabel('Price of one spool (USD)').fill('20.00');
  await record.getByRole('button', { name: 'Add to the shelf' }).click();
  await expect(record.getByText('Saved', { exact: true })).toBeVisible();

  await page.goto(`/admin/stock?q=${encodeURIComponent(colour)}`);
  const row = page.getByRole('row').filter({ hasText: colour });
  await expect(row).toHaveCount(1);
  await expect(row.locator('span[aria-hidden]').first()).toHaveCSS(
    'background-color',
    'rgb(59, 42, 110)',
  );
});

test('spools of a material the shop does not have yet create it, with its cost from the spool', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36);
  await page.goto('/admin/stock/receive');
  const record = page.getByRole('region', { name: 'Record' });
  await record
    .getByLabel('Material', { exact: true })
    .selectOption({ label: 'A new material…' });
  await record.getByLabel("New material's name").fill(`PETG ${tag}`);
  // The usual density of the filament named is filled in.
  await expect(record.getByLabel('Density (g/cm³)')).toHaveValue('1.27');
  await record.getByLabel('Spools').fill('2');
  await record.getByLabel('Each spool holds').selectOption('1000');
  await record.getByLabel('Or a new colour').fill('Smoke');
  await record.getByLabel('How it looks').fill('#555a60');
  await record.getByLabel('Price of one spool (USD)').fill('25.00');
  await record.getByRole('button', { name: 'Add to the shelf' }).click();
  await expect(record.getByText('Saved', { exact: true })).toBeVisible();

  await page.goto(`/admin/stock?q=${encodeURIComponent(`PETG ${tag}`)}`);
  const row = page.getByRole('row').filter({ hasText: `PETG ${tag}` });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Smoke');
  await expect(row).toContainText('2,000');
});
