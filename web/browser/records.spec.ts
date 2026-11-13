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

  // It has a movement: the dialog says it can't go, what keeps it and what to do instead.
  await page.getByRole('button', { name: 'Delete this filament…' }).click();
  const ask = page.getByRole('dialog');
  await expect(
    ask.getByRole('region', { name: "Can't be deleted" }),
  ).toContainText('1 stock movements');
  await expect(ask).toContainText('Track this filament');
  await ask.getByRole('button', { name: 'Close' }).click();
  await expect(ask).toHaveCount(0);

  // A category nothing uses is deleted, and the page goes back to the list.
  await page.goto('/admin/categories/new');
  await page.getByLabel('Name', { exact: true }).fill(`Spare ${tag}`);
  await page.getByLabel('Web address').fill(`spare-${tag}`);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page).toHaveURL(/\/admin\/categories\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Delete this category…' }).click();
  await expect(
    ask.getByRole('region', { name: 'Will be deleted' }),
  ).toContainText(`Spare ${tag}`);
  await ask.getByRole('button', { name: 'Delete it' }).click();
  await expect(page).toHaveURL(/\/admin\/categories(\?.*)?$/);
  await page.goto(`/admin/categories?q=${encodeURIComponent(`Spare ${tag}`)}`);
  await expect(page.getByText(`Spare ${tag}`)).toHaveCount(0);

  // From a list: two ticked, one kept by its product, the other deleted; "Keep them" first.
  for (const name of [`Used ${tag}`, `Loose ${tag}`]) {
    await page.goto('/admin/categories/new');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page
      .getByLabel('Web address')
      .fill(name.toLowerCase().replace(' ', '-'));
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page).toHaveURL(/\/admin\/categories\/[0-9a-f-]{36}$/);
  }
  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(`Piece ${tag}`);
  await page.getByLabel('Category').selectOption({ label: `Used ${tag}` });
  await page.getByLabel('Description').fill('A test piece.');
  await page.getByLabel('Material (g)').fill('10');
  await page.getByLabel('Print time (h)').fill('1');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);

  await page.goto(`/admin/categories?q=${encodeURIComponent(tag)}`);
  await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Delete…' }).click();
  await expect(
    ask.getByRole('region', { name: "Can't be deleted" }),
  ).toContainText(`Used ${tag}`);
  await expect(ask).toContainText('Used by 1 products');
  await ask.getByRole('button', { name: 'Keep them' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: `Loose ${tag}` }),
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Delete…' }).click();
  await ask.getByRole('button', { name: 'Delete it' }).click();
  await expect(ask).toHaveCount(0);
  await expect(
    page.getByRole('row').filter({ hasText: `Loose ${tag}` }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('row').filter({ hasText: `Used ${tag}` }),
  ).toHaveCount(1);
});

test('a new filament is added from its own form, listed, and deleted while nothing uses it', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const name = `Silk Red ${tag}`;
  await page.goto('/admin/stock');
  await page.getByRole('link', { name: 'New filament' }).click();
  await expect(page).toHaveURL(/\/admin\/stock\/new$/);
  await page.getByLabel('Material').selectOption({ index: 1 });
  await page.getByLabel('Name as bought').fill(name);
  await page.getByLabel('Price of one spool (USD, optional)').fill('20.00');
  await page.getByRole('button', { name: 'Add filament' }).click();
  await expect(page).toHaveURL(/\/admin\/stock\/[0-9a-f-]{36}$/);
  // Its own price: $20 for 1,000 g.
  await expect(page.getByText('$0.020', { exact: true }).first()).toBeVisible();

  await page.goto(`/admin/stock?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('link')
    .first()
    .click();
  await page.getByRole('button', { name: 'Delete this filament…' }).click();
  const ask = page.getByRole('dialog');
  await expect(
    ask.getByRole('region', { name: 'Will be deleted' }),
  ).toContainText('Nothing else uses it.');
  await ask.getByRole('button', { name: 'Delete it' }).click();
  await expect(page).toHaveURL(/\/admin\/stock(\?.*)?$/);
});
