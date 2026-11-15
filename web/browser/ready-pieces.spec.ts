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
  // A shop product's cost fills in from its grams and print time.
  await expect(page.getByLabel('What one cost to make')).toHaveValue(
    /^\d+\.\d{2}$/,
  );
  await page.getByLabel('A custom design').check();
  await expect(page.getByLabel('What one cost to make')).toHaveValue('');
  await page.getByLabel('What it is').fill(name);
  await page.getByLabel('Colour, size, text').fill('Gold, 6 cm');
  await page.getByLabel('How many').fill('6');
  await page.getByLabel('What one cost to make').fill('2.50');
  await page.getByRole('button', { name: 'Add to the shelf' }).click();
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
