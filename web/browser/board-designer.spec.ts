import type { Page } from '@playwright/test';
import { signInAsAdmin } from './admin-session';
import { expect, newVisitor, test } from './fixtures';

/**
 * A piece designed freely: the studio makes a standing initial; a customer starts from a look,
 * drags the name, adds a decoration, sees it in 3D, and the cart lists what is on it.
 */
function watch(page: Page) {
  const faults: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') faults.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => faults.push(`crash: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) faults.push(`${r.status()} ${r.url()}`);
  });
  return faults;
}

test('a customer designs a standing initial freely: drags, adds, sees it in 3D, orders it', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const tag = Date.now().toString(36);
  const studio = await newVisitor(browser);
  const admin = await studio.newPage();
  const adminFaults = watch(admin);
  await signInAsAdmin(studio, baseURL!);
  await admin.goto('/admin/products/new');
  await admin
    .getByLabel('Name', { exact: true })
    .fill(`Standing initial ${tag}`);
  await admin
    .getByLabel('Description')
    .fill(
      'A baby initial: put the name, the date and the weight where you like.',
    );
  await admin.getByLabel('Material (g)').fill('100');
  await admin.getByLabel('Print time (h)').fill('5');
  await admin.getByLabel('Customers design their own text').check();
  await admin
    .getByLabel('What it is')
    .selectOption({ label: 'Standing initial, designed freely' });
  await admin.getByRole('button', { name: 'Create product' }).click();
  await expect(admin).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
  await studio.close();

  const faults = watch(page);
  await page.goto(`/products/standing-initial-${tag}`);
  // It opens dressed in a look: the name is on it, and the price comes.
  await expect(page.getByRole('button', { name: 'Lina' })).toBeVisible();
  await expect(
    page
      .locator('[aria-live="polite"]:not([aria-busy="true"]) > p')
      .first()
      .getByText(/^\$\d+\.\d{2}$/),
  ).toBeVisible({ timeout: 30_000 });

  // Dragging the name moves it (and chooses it).
  const canvas = page.getByRole('application');
  const name = canvas.locator('g[transform^="translate"]').first();
  const before = await name.getAttribute('transform');
  const box = (await name.boundingBox())!;
  if (isMobile) {
    await name.click();
    await page.getByRole('button', { name: 'Right 1 mm' }).click();
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 40,
      box.y + box.height / 2 + 20,
      {
        steps: 6,
      },
    );
    await page.mouse.up();
  }
  await expect(name).not.toHaveAttribute('transform', before!);
  await expect(
    page.getByRole('region', { name: 'The thing chosen' }).getByLabel('Text'),
  ).toHaveValue('Lina');

  // A decoration added, made a star.
  await page.getByRole('button', { name: '+ Decoration' }).click();
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Star' }).first(),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'See it in 3D' }).click();
  await expect(
    page.getByRole('img', { name: /3D preview/ }).locator('canvas'),
  ).toBeVisible();
  const add = page.getByRole('button', { name: 'Add to cart' });
  await expect(add).toBeEnabled({ timeout: 30_000 });
  await add.click();
  await expect(page.getByText('In your cart.')).toBeVisible({
    timeout: 20_000,
  });

  await page.goto('/cart');
  await expect(page.getByText(/On it: Lina .*Star in/)).toBeVisible();
  expect(faults).toEqual([]);
  expect(adminFaults).toEqual([]);
});
