import { cube } from '../../api/prisma/example-models';
import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

/** A badge: a square with a square hole. */
const BADGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/></svg>';

test('the owner puts a name and a logo on any product; a customer writes their own name', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36);

  // A logo, from an SVG drawing.
  await page.goto('/admin/logos/new');
  await page.getByLabel('SVG file (up to 1 MB)').setInputFiles({
    name: 'badge.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(BADGE),
  });
  await page.getByLabel('Name', { exact: true }).fill(`Badge ${tag}`);
  await page.getByRole('button', { name: 'Add the logo' }).click();
  await expect(page).toHaveURL(/\/admin\/logos\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('img', { name: `The Badge ${tag} logo` }),
  ).toBeVisible();

  // A product with a model, a name on its front and the logo on top.
  const name = `Name cube ${tag}`;
  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Description').fill('A cube that carries a name.');
  await page.getByLabel(/3D model \(STL, GLB or 3MF/).setInputFiles({
    name: 'cube.stl',
    mimeType: 'model/stl',
    buffer: cube(40),
  });
  await page
    .getByRole('button', { name: 'Upload', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Use these numbers' }).click();
  await expect(page.getByLabel('Material (g)')).not.toHaveValue('');

  // The section starts folded on a new product.
  await page.getByText('Text and logos', { exact: true }).click();
  await page
    .getByLabel('Colours they print in')
    .selectOption({ label: 'Colour' });
  await page.getByRole('button', { name: 'Add text' }).click();
  await page
    .getByLabel('Text it shows (customers may change it)')
    .fill('Forgea');
  // Its own 3D view is measured, then the sides can be picked.
  const front = page.getByRole('button', { name: 'Front', exact: true });
  await expect(front).toBeEnabled({ timeout: 20_000 });
  await front.click();
  await page.getByRole('button', { name: 'Add a logo' }).click();
  await page.getByLabel('Logo', { exact: true }).selectOption({
    label: `Badge ${tag}`,
  });
  await page.getByRole('button', { name: 'Top', exact: true }).last().click();
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/2 places/)).toBeVisible();

  // In the shop: the customer types their name, and the cart keeps it.
  await page.goto(`/products/name-cube-${tag}`);
  await expect(
    page.getByRole('heading', { name: 'Make it yours' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sara');
  await page.getByLabel('Show the logo').uncheck();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await page.goto('/cart');
  const line = page.getByRole('article').filter({ hasText: name }).first();
  await expect(line.getByText('“Sara”')).toBeVisible();
  // Turned off: no logo on it.
  await expect(line.getByText(`Badge ${tag}`)).toHaveCount(0);
});
