import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'One run is enough');

test('a custom design kept on the shelf is sold, and the production results show the shelf', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const name = `Favour ${Date.now().toString(36)}`;
  await page.goto('/admin/stock/pieces');

  // Printed to sell: the product shows with its model and colours; its filament comes off the
  // shelf and the piece goes on it at what it cost to make.
  const printed = page.getByRole('region', { name: 'Printed to sell' });
  const product = await printed
    .getByLabel('Product')
    .locator('option:checked')
    .innerText();
  const productName = product.replace(/ \([^)]*\)$/, '');
  await expect(printed.getByText(/^One: .* to make$/)).toBeVisible();
  await printed.getByLabel('How many').fill('1');
  await printed.getByRole('button', { name: 'Put them on the shelf' }).click();
  await expect(printed.getByText('Saved')).toBeVisible();
  await expect(
    page.getByRole('row', { name: new RegExp(productName) }).first(),
  ).toBeVisible();

  // By hand: a shop product's cost fills in from its grams and print time.
  const byHand = page.getByRole('region', { name: 'Add pieces by hand' });
  await expect(byHand.getByLabel('What one cost to make')).toHaveValue(
    /^\d+\.\d{2}$/,
  );
  await byHand.getByLabel('A custom design').check();
  await expect(byHand.getByLabel('What one cost to make')).toHaveValue('');
  await byHand.getByLabel('What it is').fill(name);
  await byHand.getByLabel('Colour, size, text').fill('Gold, 6 cm');
  await byHand.getByLabel('How many').fill('6');
  await byHand.getByLabel('What one cost to make').fill('2.50');
  await byHand.getByRole('button', { name: 'Add to the shelf' }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('6');
  await expect(row).toContainText('$15.00');

  await row.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByLabel('How many', { exact: true }).fill('2');
  await page.getByLabel('Note (optional)').first().fill('Market stall');
  await page.getByRole('button', { name: 'Take them off' }).click();
  await expect(page.getByText(/4 on the shelf/)).toBeVisible();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByText('Sold')).toBeVisible();
  await expect(history.getByText('Added by hand')).toBeVisible();

  await page.goto('/admin/production/results');
  await expect(
    page.getByRole('heading', { name: 'Production results' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Ready pieces' })
      .getByText('On the shelf now'),
  ).toBeVisible();
});
