import { readFileSync } from 'node:fs';
import { finishSignUp } from './mail';
import type { Page } from '@playwright/test';
import { signInAsAdmin } from './admin-session';
import { closeDashboardMenu, expect, newVisitor, test } from './fixtures';

/**
 * The text studio, as a customer and the studio use it: a name designed in 3D (English and
 * Arabic, fonts and colours), priced by the API, ordered, and printed from the files the
 * dashboard gives. Fails on any console error, crash or server error on the way.
 */
const tag = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function watch(page: Page) {
  const faults: string[] = [];
  page.on('console', (m) => {
    const refused = /^Failed to load resource: .* status of 4\d\d/.test(
      m.text(),
    );
    if (m.type() === 'error' && !refused) faults.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => faults.push(`crash: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) faults.push(`${r.status()} ${r.url()}`);
  });
  return faults;
}

/** The live price (the first line of the block that announces it), once it is for the design on screen. */
const price = (page: Page) =>
  page
    .locator('[aria-live="polite"]:not([aria-busy="true"]) > p')
    .first()
    .getByText(/^\$\d+\.\d{2}$/);

test('a customer designs a name keychain in 3D, in English and Arabic; the studio prints it', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const faults = watch(page);

  // The studio adds a font (the seed brought four).
  const studio = await newVisitor(browser);
  const admin = await studio.newPage();
  const adminFaults = watch(admin);
  await signInAsAdmin(studio, baseURL!);
  await admin.goto('/admin/fonts');
  await closeDashboardMenu(admin);
  await expect(
    admin
      .getByRole('table', { name: 'Fonts' })
      .getByRole('link', { name: 'Cairo', exact: true }),
  ).toBeVisible();
  await admin.getByRole('link', { name: 'New font' }).click();
  await expect(admin).toHaveURL(/\/admin\/fonts\/new$/);
  const name = `Ruqaa ${tag()}`;
  await admin.getByLabel('Font file (TTF or OTF)').setInputFiles({
    name: 'ArefRuqaa.ttf',
    mimeType: 'font/ttf',
    buffer: readFileSync(
      new URL('../../api/prisma/example-fonts/ArefRuqaa.ttf', import.meta.url),
    ),
  });
  await admin.getByLabel('Name customers see (optional)').fill(name);
  await admin.getByRole('button', { name: 'Add the font' }).click();
  // It opens on its own page.
  await expect(admin.getByRole('heading', { name, level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(admin).toHaveURL(/\/admin\/fonts\/[0-9a-f-]{36}$/);
  await expect(
    admin.getByRole('region', { name: 'Sample' }).getByText(/Writes .*Arabic/),
  ).toBeVisible();

  // The customer designs.
  // The shop sends people to design it, not straight to the cart.
  await page.goto('/shop?category=personalised');
  await page.getByRole('link', { name: 'Design your Name keychain' }).click();
  await expect(page).toHaveURL(/\/products\/name-keychain$/);
  await expect(
    page
      .getByRole('img', { name: /3D preview of Name keychain/ })
      .locator('canvas'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('button', {
      name: /^Type your (text first|name or add your logo)$/,
    }),
  ).toBeDisabled();
  // It starts in our colours: copper letters on black.
  await expect(
    page
      .getByRole('radiogroup', { name: 'Letters colour' })
      .getByRole('radio', { name: 'Copper silk' }),
  ).toBeChecked();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Backing colour' })
      .getByRole('radio', { name: 'Black' }),
  ).toBeChecked();
  // The price is asked for with what this browser built: the server builds nothing while
  // the customer types.
  const measuredPrice = page.waitForRequest(
    (r) =>
      r.method() === 'POST' &&
      r.url().includes(`/products/`) &&
      (r.postData() ?? '').includes('measured='),
  );
  await page.getByLabel(/Your text/).fill('Sara');
  await measuredPrice;
  // One colour first (the backing as the letters), to compare against.
  await page
    .getByRole('radiogroup', { name: 'Backing colour' })
    .getByText('Same as the letters')
    .click();
  await expect(price(page)).toBeVisible({ timeout: 15_000 });
  const valueOf = async () =>
    Number((await price(page).textContent())!.slice(1));
  await expect(async () => {
    expect(await valueOf()).toBeGreaterThan(0);
  }).toPass();
  // A bigger size costs more.
  const small = await valueOf();
  await page.getByText('13 mm letters').click();
  await expect(async () => {
    expect(await valueOf()).toBeGreaterThan(small);
  }).toPass({ timeout: 15_000 });
  const plain = await valueOf();
  await page
    .getByRole('radiogroup', { name: 'Font' })
    .locator('label')
    .filter({ has: page.getByText('Pacifico', { exact: true }) })
    .click();
  await expect(
    page.getByRole('radio', { name: /^Sara Pacifico$/ }),
  ).toBeChecked();
  await page
    .getByRole('radiogroup', { name: 'Backing colour' })
    .getByTitle('White')
    .click();
  // A second colour costs the product's $1.00 more (the shape barely changes the grams).
  await expect(async () => {
    const two = Number((await price(page).textContent())!.slice(1));
    expect(two).toBeGreaterThan(plain + 0.5);
  }).toPass({ timeout: 15_000 });

  // Arabic: only fonts that write it are offered.
  await page.getByLabel(/Your text/).fill('سارة');
  await expect(page.getByRole('radio', { name: /Pacifico/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^سارة Cairo$/ })).toHaveCount(
    1,
  );
  await expect(price(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/cart');
  const line = page.getByRole('article').filter({ hasText: 'Name keychain' });
  await expect(line.getByText('“سارة”')).toBeVisible();
  await expect(line.getByText(/on White/)).toBeVisible();

  // Ordered by a new customer.
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Name (optional)').fill('Sara Studio');
  await page.getByLabel('Email').fill(`studio-${tag()}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await finishSignUp(page);
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByLabel('Phone').fill('70 222 111');
  await page.getByLabel('Pick up from the studio (no delivery fee)').check();
  await page.getByLabel('Cash on delivery').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order placed')).toBeVisible();
  const order =
    (await page.locator('strong.font-mono').first().textContent()) ?? '';
  await page.goto('/orders');
  await expect(
    page.getByRole('article', { name: order }).getByText('“سارة”'),
  ).toBeVisible();

  // The studio downloads the print file for each colour.
  await admin.goto(`/admin/orders?q=${order}`);
  await admin.getByRole('link', { name: order }).first().click();
  await expect(admin.getByText('“سارة”')).toBeVisible();
  // Copper silk letters (the product's starting colour) on the White backing chosen.
  for (const colour of ['White', 'Copper silk']) {
    const link = admin.getByRole('link', { name: `Print file: ${colour}` });
    const res = await admin.request.get((await link.getAttribute('href'))!);
    expect(res.status(), colour).toBe(200);
    expect(res.headers()['content-type']).toBe('model/stl');
    expect(res.headers()['content-disposition']).toContain(
      `${order}-${colour.toLowerCase().replace(' ', '-')}.stl`,
    );
    const body = await res.body();
    expect(body.byteLength).toBe(84 + body.readUInt32LE(80) * 50);
  }
  // Or both colours at once: one 3MF project, a part per colour.
  const project = await admin.request.get(
    (await admin
      .getByRole('link', { name: 'Download all (3MF)' })
      .getAttribute('href'))!,
  );
  expect(project.status()).toBe(200);
  expect(project.headers()['content-type']).toBe('model/3mf');
  expect(project.headers()['content-disposition']).toContain(`${order}.3mf`);
  // A zip (3MF is one), starting with its local file header.
  expect((await project.body()).readUInt32LE(0)).toBe(0x04034b50);
  // A customer gets nothing from it.
  const stranger = await page.request.get(
    (await admin
      .getByRole('link', { name: 'Print file: White' })
      .getAttribute('href'))!,
  );
  expect(stranger.status()).toBeGreaterThanOrEqual(400);

  await studio.close();
  expect([...faults, ...adminFaults]).toEqual([]);
});

test('curved initials: each letter its own font and colour', async ({
  page,
}) => {
  const faults = watch(page);
  await page.goto('/products/curved-initials');
  await page.getByLabel(/Your initials/).fill('SAM');
  await expect(page.getByText('Each letter')).toBeVisible();
  await page.getByLabel('Font for A').selectOption({ label: 'Pacifico' });
  await page
    .getByRole('radiogroup', { name: 'Colour for A' })
    .getByTitle('Gold silk')
    .click();
  await expect(price(page)).toBeVisible({ timeout: 15_000 });
  // Four letters is too many for initials.
  await page.getByLabel(/Your initials/).fill('SAMI');
  await expect(page.getByText(/At most 3 characters/).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add to cart' }),
  ).toBeDisabled();
  expect(faults).toEqual([]);
});

test("a baby's big initial with the name and flowers; two names and a heart", async ({
  page,
}) => {
  const faults = watch(page);
  await page.goto('/products/baby-initial-name');
  await expect(
    page
      .getByRole('img', { name: /3D preview of Baby's initial and name/ })
      .locator('canvas'),
  ).toBeVisible({ timeout: 20_000 });
  // It starts in our colours: copper name, white initial and flowers, on black.
  await expect(
    page
      .getByRole('radiogroup', { name: 'Initial and decorations colour' })
      .getByRole('radio', { name: 'White' }),
  ).toBeChecked();
  await page.getByLabel(/The name/).fill('Lina');
  await page
    .getByLabel('Font for the big initial')
    .selectOption({ label: 'Lalezar' });
  await expect(price(page)).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('radiogroup', { name: 'Initial and decorations colour' })
    .getByTitle('Gold silk')
    .click();
  await expect(
    page.getByText(/Copper silk letters, Gold silk initial/),
  ).toBeVisible();
  await page.getByText('100 mm initial').click();
  await expect(price(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/products/couple-names');
  await page.getByLabel(/First name/).fill('Sara');
  // One name is not enough.
  await expect(page.getByText('Type both names').first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel(/Second name/).fill('Ali');
  await expect(price(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/cart');
  const baby = page
    .getByRole('article')
    .filter({ hasText: "Baby's initial and name" });
  await expect(
    baby.getByText(/initial Gold silk \(initial in Lalezar\)/),
  ).toBeVisible();
  const couple = page
    .getByRole('article')
    .filter({ hasText: 'Two names and a heart' });
  await expect(couple.getByText('“Sara & Ali”')).toBeVisible();
  await expect(couple.getByText(/heart Red/)).toBeVisible();
  expect(faults).toEqual([]);
});

test('the studio saves a personalised product and customers still design it', async ({
  page,
  browser,
  baseURL,
}) => {
  const studio = await newVisitor(browser);
  const admin = await studio.newPage();
  const faults = watch(admin);
  await signInAsAdmin(studio, baseURL!);
  await admin.goto('/admin/products?q=Single%20letters');
  await admin.getByRole('link', { name: 'Single letters' }).first().click();
  const textOn = admin.getByLabel('Customers design their own text');
  await expect(textOn).toBeChecked();
  // Saved as it is: its text settings go with it (they were once dropped).
  await admin.getByRole('button', { name: 'Save product' }).click();
  await expect(admin.getByText('Saved', { exact: true })).toBeVisible();
  await admin.reload();
  await expect(textOn).toBeChecked();
  await expect(admin.getByLabel('What it is')).toHaveValue('LETTERS');
  await studio.close();

  await page.goto('/products/single-letters');
  await expect(page.getByLabel(/Your text/)).toBeVisible();
  expect(faults).toEqual([]);
});
