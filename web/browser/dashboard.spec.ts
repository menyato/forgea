import { expect, test } from './fixtures';
import { cube } from '../../api/prisma/example-models';
import { signInAsAdmin } from './admin-session';

test('the owner adds a product with a 3D model and options, and a shopper buys it in a colour', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36);
  const name = `Test cube ${tag}`;

  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await expect(page.getByLabel('Web address')).toHaveValue(`test-cube-${tag}`);
  await page
    .getByLabel('Description')
    .fill('A 30 mm calibration cube, printed to order.');

  // Upload an STL: it appears in 3D and is measured.
  await page.getByLabel(/3D model \(STL or GLB/).setInputFiles({
    name: 'cube.stl',
    mimeType: 'model/stl',
    buffer: cube(30),
  });
  await page
    .getByRole('button', { name: 'Upload', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('img', { name: /3D view of Test cube/ }).locator('canvas'),
  ).toBeVisible();
  await expect(
    page.getByText('Size 30 × 30 × 30 mm · volume 27.0 cm³'),
  ).toBeVisible();

  // Grams and hours suggested from the volume and the material's density and speed.
  await page.getByRole('button', { name: 'Use these numbers' }).click();
  await expect(page.getByLabel('Material (g)')).not.toHaveValue('');
  await expect(page.getByLabel('Print time (h)')).not.toHaveValue('');

  // Offer the colours (the seeded Colour option), Black by default.
  await page.getByLabel('Offer Colour', { exact: true }).check();
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Price with default options:')).toBeVisible();

  // In the shop: the 3D view, the colours, the price, and the cart line with the colour.
  await page.goto(`/products/test-cube-${tag}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByText('Forest green').click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await page.goto('/cart');
  // The admin's cart is shared by the desktop and phone runs: find this product's line.
  const line = page.getByRole('article').filter({ hasText: name });
  await expect(line.getByText('Colour: Forest green')).toBeVisible();
});

test('a text option must be filled in, and its price is added', async ({
  page,
}) => {
  await page.goto('/products/name-keychain');
  const add = page.getByRole('button', { name: /^Choose / });
  await expect(add).toBeDisabled();
  await page.getByText('Black').click();
  const before = await page.locator('p.text-3xl').textContent();
  await page.getByRole('textbox', { name: 'Name on it' }).fill('Rana');
  await expect(page.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  await expect(page.locator('p.text-3xl')).not.toHaveText(before ?? '');
});

test('customers cannot open the dashboard', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin/);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Name (optional)').fill('Curious');
  await page.getByLabel('Email').fill(`curious-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Not allowed' }),
  ).toBeVisible();
});
