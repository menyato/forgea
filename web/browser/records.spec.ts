import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test('a vendor bill shelves its reels at their real cost, and a record history uses cannot be deleted', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // A supplier's bill: two lines and a discount on the whole bill.
  await page.goto('/admin/stock/purchase');
  await page.getByLabel('Vendor').fill(`Elegoo ${tag}`);
  await page.getByLabel('Their invoice number (optional)').fill(`INV-${tag}`);
  const lines = page.getByRole('list', { name: 'Bill lines' });
  await lines.getByLabel('Filament as bought').fill(`Matte White ${tag}`);
  await lines.getByLabel('Price of one (USD)').fill('17.00');
  await page.getByRole('button', { name: 'Add a line' }).click();
  await lines
    .getByLabel('Filament as bought')
    .nth(1)
    .fill(`Rapid Black ${tag}`);
  await lines.getByLabel('Price of one (USD)').nth(1).fill('20.00');
  await page.getByLabel('Discount on the bill (USD)').fill('7.00');
  await expect(
    page.getByText(/\$37\.00.*less \$7\.00 = \$30\.00/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add the bill to the shelf' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // On the shelf: the discount shared by price (17/37 of $30 = $13.78 for 1 kg).
  await page.goto(`/admin/stock?q=${encodeURIComponent(`Matte White ${tag}`)}`);
  const row = page.getByRole('row').filter({ hasText: `Matte White ${tag}` });
  await expect(row).toContainText('1,000');
  await row.getByRole('link').first().click();
  await expect(page.getByText('$0.014', { exact: true }).first()).toBeVisible();

  // It has a movement: deleting it is refused, with what to do instead.
  await page.getByLabel('Yes, delete this filament line').check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Track this filament');

  // A category nothing uses is deleted, and the page goes back to the list.
  await page.goto('/admin/categories/new');
  await page.getByLabel('Name', { exact: true }).fill(`Spare ${tag}`);
  await page.getByLabel('Web address').fill(`spare-${tag}`);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page).toHaveURL(/\/admin\/categories\/[0-9a-f-]{36}$/);
  await page.getByLabel('Yes, delete this category').check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/categories(\?.*)?$/);
  await page.goto(`/admin/categories?q=${encodeURIComponent(`Spare ${tag}`)}`);
  await expect(page.getByText(`Spare ${tag}`)).toHaveCount(0);
});
