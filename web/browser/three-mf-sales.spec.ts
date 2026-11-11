import { bambuThreeMf } from '../../api/test/three-mf-file';
import { signInAsAdmin } from './admin-session';
import { expect, newVisitor, test } from './fixtures';
import { signUp } from './sign-up';

test('a customer sends a sliced Bambu Studio file, gets its exact price as a quote at once, and orders; the studio downloads the file', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = `Two-colour piece ${Date.now().toString(36)}`;

  // The file shows in 3D and its exact price comes from the slicer's numbers.
  await signUp(page, '/custom');
  await page.getByLabel('3D file or photo (optional)').setInputFiles({
    name: 'piece.gcode.3mf',
    mimeType: 'model/3mf',
    buffer: bambuThreeMf({ sliced: true }),
  });
  await expect(
    page.getByRole('img', { name: /3D view of your model/ }).locator('canvas'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/this is your quote: you can order straight away/),
  ).toBeVisible();
  await page.getByLabel('What is it?').fill(title);
  await page
    .getByLabel('Describe it')
    .fill('Printed as my sliced file says, in its two colours.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Request sent.')).toBeVisible();

  // Quoted already: the customer orders without waiting for the studio.
  await expect(
    page.getByText(/Priced from your sliced file/).first(),
  ).toBeVisible();
  await page.getByLabel('Phone').fill('70 123 456');
  await page.getByLabel('Pick up from the studio (no delivery fee)').check();
  await page.getByLabel('Money transfer to our number').check();
  await page
    .getByRole('button', { name: 'Accept and place the order' })
    .click();
  await expect(page.getByText('Order placed')).toBeVisible();
  const orderNumber =
    (await page.locator('strong.font-mono').first().textContent()) ?? '';
  expect(orderNumber).toMatch(/^FG-/);

  // The studio finds the order with the customer's file ready for the slicer.
  const studio = await newVisitor(browser);
  await signInAsAdmin(studio, baseURL!);
  const admin = await studio.newPage();
  await admin.goto(`/admin/orders?q=${orderNumber}`);
  await admin.getByRole('link', { name: orderNumber }).click();
  // The order in figures, each joined to where it comes from.
  const figures = admin.getByRole('list', { name: 'This order in figures' });
  await expect(figures.getByRole('link', { name: /Filament/ })).toContainText(
    '12.5 g',
  );
  await expect(figures.getByText('Print time')).toBeVisible();
  await expect(figures.getByRole('link', { name: /Profit/ })).toBeVisible();
  await expect(
    admin.getByRole('table', { name: 'Filament by line' }),
  ).toContainText('g ');
  const download = admin.waitForEvent('download');
  await admin
    .getByRole('link', { name: 'Download print project (3MF)' })
    .click();
  expect((await download).suggestedFilename()).toBe(`${orderNumber}-print.3mf`);
  await studio.close();
});

test('the studio prices a quotation line from a 3MF: grams, time, colours and size from the file', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36);
  await page.goto('/admin/quotations/new');
  await page.getByLabel('Customer email').fill(`quote-${tag}@example.com`);
  await page.getByLabel('Name for the order').fill('Nour Three-MF');
  await page.getByLabel('Phone').fill('70 123 456');

  await page.getByLabel(/3D file for this line/).setInputFiles({
    name: 'piece.gcode.3mf',
    mimeType: 'model/3mf',
    buffer: bambuThreeMf({ sliced: true }),
  });
  await expect(page.getByText('From a 3D file:')).toBeVisible();
  await expect(page.getByText(/12\.50 g, 1\.50 h a piece/)).toBeVisible();
  await expect(page.getByText('(from the slicer)')).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveValue('Custom print');
  await expect(page.getByLabel('Unit price')).not.toHaveValue('');
  await expect(page.getByLabel('Height')).toHaveValue('2.0');
  await expect(page.getByLabel('Made to order')).toBeChecked();

  await page.getByRole('button', { name: 'Create the quotation' }).click();
  await expect(page).toHaveURL(/\/admin\/quotations\/[0-9a-f-]{36}$/);
  // Kept with the line, read again from the file when it was saved.
  await expect(page.getByText(/12\.50 g, 1\.50 h a piece/)).toBeVisible();
});
