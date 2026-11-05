import { cube } from '../../api/prisma/example-models';
import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test('a product is sold in real sizes: measured from its model, shown in cm, priced by size', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const name = `Sized cube ${tag}`;

  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Description').fill('A cube in three real sizes.');
  await page.getByLabel(/3D model \(STL or GLB/).setInputFiles({
    name: 'cube.stl',
    mimeType: 'model/stl',
    buffer: cube(30),
  });
  await page
    .getByRole('button', { name: 'Upload', exact: true })
    .first()
    .click();
  await expect(page.getByText(/Size 30 × 30 × 30 mm/)).toBeVisible();

  // The model's size, grams and hours in one click; then three sizes from them.
  await page.getByRole('button', { name: 'Use these numbers' }).click();
  const size = page.getByRole('group', { name: /Printed size, cm/ });
  await expect(size.getByLabel('Height')).toHaveValue('3.0');
  await page.getByRole('button', { name: 'Small, Standard and Large' }).click();
  const large = page.getByRole('group', { name: 'Size Large' });
  await expect(large.getByLabel('Height cm')).toHaveValue('3.9');
  await expect(large.getByLabel('Width cm')).toHaveValue('3.9');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('group', { name: 'Size Standard' }),
  ).toBeVisible();

  // The shop: each size with its measurements; the price follows the size.
  await page.goto(`/products/sized-cube-${tag}`);
  const sizes = page.getByRole('radiogroup').first();
  await expect(sizes.getByText('3.9 × 3.9 × 3.9 cm')).toBeVisible();
  await expect(sizes.getByText('2.3 × 2.3 × 2.3 cm')).toBeVisible();
  const price = page.locator('p.text-3xl');
  const standard = await price.textContent();
  // Customers choose by measurements; the names stay in the dashboard.
  await expect(sizes.getByText(/Small|Standard|Large/)).toHaveCount(0);
  await sizes
    .locator('label')
    .filter({ hasText: '3.9 × 3.9 × 3.9 cm' })
    .click();
  await expect(price).not.toHaveText(standard ?? '');

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await page.goto('/cart');
  const line = page.getByRole('article').filter({ hasText: name });
  await expect(line.getByText('Size: 3.9 × 3.9 × 3.9 cm')).toBeVisible();

  // A quotation offers the product's own sizes, each at its price.
  await page.goto('/admin/quotations/new');
  await page.getByLabel('Product').selectOption({ label: name });
  const quoteSize = page.getByLabel('Size');
  const large3 = await quoteSize
    .locator('option', { hasText: '3.9 × 3.9 × 3.9 cm' })
    .getAttribute('value');
  await quoteSize.selectOption(large3!);
  await expect(page.getByLabel('Unit price')).not.toHaveValue(
    (standard ?? '').replace(/[^0-9.]/g, ''),
  );
  await expect(page.getByLabel('Width')).toHaveCount(0);
});
