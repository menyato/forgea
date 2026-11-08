import { bambuThreeMf } from '../../api/test/three-mf-file';
import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test('a product from a sliced Bambu Studio 3MF: its colours, grams and time, and the owner’s own price', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const name = `Two-colour piece ${tag}`;

  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Description').fill('A piece printed in two colours.');
  await page.getByLabel(/3D model \(STL, GLB or 3MF/).setInputFiles({
    name: 'piece.gcode.3mf',
    mimeType: 'model/3mf',
    buffer: bambuThreeMf({ sliced: true }),
  });
  await page
    .getByRole('button', { name: 'Upload', exact: true })
    .first()
    .click();

  // The API reads the file: the slicer's own time and grams, per colour.
  await page
    .getByRole('button', { name: 'Read colours, grams and time from the file' })
    .click();
  await expect(
    page.getByText('(from the slicer: the file was sliced)'),
  ).toBeVisible();
  await expect(page.getByText('10.25 g')).toBeVisible();
  await expect(page.getByText('2.25 g')).toBeVisible();
  await page.getByRole('button', { name: 'Use these numbers' }).click();
  await expect(page.getByLabel('Material (g)')).toHaveValue('12.5');
  await expect(page.getByLabel('Print time (h)')).toHaveValue('1.50');

  // Each file colour gets the shop's name for it: that is the stock it comes from.
  await page.getByLabel(/Colour 1 \(file colour #aa2222\)/).fill('Red');
  await page.getByLabel(/Colour 2 \(file colour #b87333\)/).fill('Copper');

  // The calculated price stays in view beside the owner's own.
  await page.getByLabel('Use my own price').check();
  await page.getByLabel('My price (USD)').fill('30');
  await expect(page.getByText(/your price; calculated:/)).toBeVisible();

  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('My price (USD)')).toHaveValue('30.00');
  await expect(page.getByLabel(/Colour 2 \(file colour #b87333\)/)).toHaveValue(
    'Copper',
  );

  // The shop sells it at the owner's price and shows it in 3D.
  await page.goto(`/products/two-colour-piece-${tag}`);
  await expect(page.locator('p.text-3xl')).toHaveText(/30\.00/);
});

test('customers recolour the parts of a 3MF product: each colour priced by its own rule, the cart keeps them', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(`Panda ${tag}`);
  await page.getByLabel('Description').fill('A panda in two colours.');
  await page.getByLabel(/3D model \(STL, GLB or 3MF/).setInputFiles({
    name: 'panda.gcode.3mf',
    mimeType: 'model/3mf',
    buffer: bambuThreeMf({ sliced: true }),
  });
  await page
    .getByRole('button', { name: 'Upload', exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Read colours, grams and time from the file' })
    .click();
  await page.getByRole('button', { name: 'Use these numbers' }).click();

  // The owner names the parts customers recolour; the colour beside each is where it starts.
  await page.getByLabel(/Colour 1 \(file colour #aa2222\)/).fill('Black');
  await page.getByLabel(/Colour 2 \(file colour #b87333\)/).fill('Copper silk');
  await page
    .getByLabel('Part customers recolour, colour 1 (optional)')
    .fill('Body');
  await page
    .getByLabel('Part customers recolour, colour 2 (optional)')
    .fill('Ears');
  await page
    .getByLabel('Colours customers choose parts in')
    .selectOption({ label: 'Colour' });
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(
    page.getByLabel('Part customers recolour, colour 2 (optional)'),
  ).toHaveValue('Ears');

  // The shop offers each part in the group's colours, starting as the owner set them.
  await page.goto(`/products/panda-${tag}`);
  await expect(
    page.getByRole('img', { name: /3D view of Panda/ }).locator('canvas'),
  ).toBeVisible({ timeout: 15_000 });
  const ears = page.getByRole('group', { name: 'Ears' });
  await expect(ears.getByRole('radio', { name: 'Copper silk' })).toBeChecked();
  await expect(
    page
      .getByRole('group', { name: 'Body' })
      .getByRole('radio', { name: 'Black' }),
  ).toBeChecked();
  const price = page.locator('p.text-3xl');
  const before = Number((await price.textContent())?.replace(/[^0-9.]/g, ''));
  // Black has no add-on, copper silk's is $1.50.
  await ears.getByText('Black', { exact: true }).click();
  await expect(price).toHaveText(new RegExp((before - 1.5).toFixed(2)));

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: /Added/ })).toBeVisible();
  await page.goto('/cart');
  const line = page.getByRole('article').filter({ hasText: `Panda ${tag}` });
  await expect(line).toContainText('Body: Black');
  await expect(line).toContainText('Ears: Black');
});
