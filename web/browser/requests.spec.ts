import { palettes } from '@forgea/brand';
import type { Browser, Page } from '@playwright/test';
import { cube } from '../../api/prisma/example-models';
import { signInAsAdmin } from './admin-session';
import { signUp } from './sign-up';
import { expect, test, newVisitor } from './fixtures';

/** The dashboard's save confirmation (SaveStatus), not other text that says "Saved". */
const saved = (page: Page) =>
  page.locator('p[aria-live="polite"]').getByText('Saved', { exact: true });

test('a customer asks for something custom, the studio quotes it, the customer orders it', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = `Shelf bracket ${Date.now().toString(36)}`;

  // 1. The customer attaches a 3D model, sees it in 3D with an instant price range, and sends.
  await signUp(page, '/custom');
  await page.getByLabel('3D file or photo (optional)').setInputFiles({
    name: 'bracket.stl',
    mimeType: 'model/stl',
    buffer: cube(40),
  });
  await expect(
    page.getByRole('img', { name: /3D view of your model/ }).locator('canvas'),
    // three.js loads on demand: slower when the whole suite runs at once.
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^About \$\d+\.00–\$\d+\.00$/)).toBeVisible();
  await page.getByLabel('What is it?').fill(title);
  await page
    .getByLabel('Describe it')
    .fill('Two brackets for a 20 mm pine shelf, in matte black.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Request sent.')).toBeVisible();
  await expect(page.getByText(/· Waiting for a quote./)).toBeVisible();
  const requestUrl = page.url();

  // 2. The studio sends the quote from the dashboard.
  const studio = await newVisitor(browser);
  await signInAsAdmin(studio, baseURL!);
  const admin = await studio.newPage();
  await admin.goto('/admin/requests?status=SUBMITTED');
  await admin.getByRole('link', { name: new RegExp(title) }).click();
  await expect(admin.getByRole('heading', { name: title })).toBeVisible();
  // The studio saves the customer's file under the name they sent it with.
  const download = admin.waitForEvent('download');
  await admin
    .getByRole('link', { name: "Download the customer's file" })
    .click();
  expect((await download).suggestedFilename()).toBe('bracket.stl');
  await admin.getByLabel('Price (USD, for everything)').fill('30');
  await admin
    .getByLabel('Note for the customer (optional)')
    .fill('Printed in PETG for strength.');
  await admin.getByRole('button', { name: 'Send the quote' }).click();
  await expect(saved(admin)).toBeVisible();

  // 3. The customer sees it and accepts: an order awaiting the 50% deposit.
  await page.goto(requestUrl);
  // In the quote and in the timeline.
  await expect(
    page.getByText('Printed in PETG for strength.').first(),
  ).toBeVisible();
  await page.getByLabel('Phone').fill('70 123 456');
  await page.getByLabel('Pick up from Forgea Lab (no delivery fee)').check();
  await page.getByLabel('Money transfer to our number').check();
  await page
    .getByRole('button', { name: 'Accept and place the order' })
    .click();
  await expect(page.getByText('Order placed')).toBeVisible();
  const orderNumber =
    (await page.locator('strong.font-mono').first().textContent()) ?? '';
  expect(orderNumber).toMatch(/^FG-/);

  // 4. The studio marks the deposit received; the history says who did it.
  await admin.goto(`/admin/orders?q=${orderNumber}`);
  await admin.getByRole('link', { name: orderNumber }).click();
  await expect(admin.getByText(/From custom request CR-/)).toBeVisible();
  await admin
    .getByLabel('Note for the customer (optional)')
    .fill('Deposit by Whish');
  await admin
    .getByRole('button', { name: 'Deposit received, confirm' })
    .click();
  await expect(saved(admin)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText('Deposit by Whish')).toBeVisible();
  await expect(admin.getByText(/received/).first()).toBeVisible();
  await studio.close();
});

test('the owner changes the site palette; every page follows; then goes back', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  // One palette for the whole site: run once, not on both screen sizes at the same time.
  test.skip(testInfo.project.name !== 'desktop', 'changes shared settings');
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/theme');
  await page.getByRole('button', { name: 'maroon' }).click();
  await page.getByRole('button', { name: 'Save and apply' }).click();
  await expect(saved(page)).toBeVisible();

  await page.goto('/shop');
  const accent = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--forgea-color-accent')
        .trim(),
    );
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await accent()).toBe('#8a1538');

  // An unreadable colour is saved only once fixed, or kept on purpose.
  await page.goto('/admin/theme');
  const onAccent = page.getByLabel(/Text on the accent/).first();
  await onAccent.fill('#8a1538');
  const blocked = page.getByRole('button', {
    name: 'Fix the contrast, or keep it, to save',
  });
  await expect(blocked).toBeDisabled();
  await page.getByLabel(/Keep my colours anyway/).check();
  await expect(
    page.getByRole('button', { name: 'Save and apply' }),
  ).toBeEnabled();
  await page.getByLabel(/Keep my colours anyway/).uncheck();
  await page.getByRole('button', { name: 'Fix the contrast for me' }).click();
  await expect(onAccent).not.toHaveValue('#8a1538');
  await page.getByRole('button', { name: 'Save and apply' }).click();
  await expect(saved(page)).toBeVisible();
  await page.goto('/shop');
  expect(await accent()).toBe('#8a1538');
  await page.goto('/admin/theme');

  await page
    .getByRole('button', { name: 'Back to the original colours' })
    .click();
  await expect(saved(page)).toBeVisible();
  await page.goto('/shop');
  expect(await accent()).toBe('#c87533');
});

/** A second visitor in their own browser. */
async function visitorBrowser(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      'cf-connecting-ip': `198.18.${Math.floor(Math.random() * 254) + 1}.78`,
    },
  });
  return { context, page: await context.newPage() };
}

test('saved themes switch the whole site for every visitor; "back to the original" really goes back', async ({
  page,
  context,
  baseURL,
  browser,
}, testInfo) => {
  // The site has one theme: change it from one run only.
  test.skip(
    testInfo.project.name !== 'desktop',
    'one site theme, changed once',
  );
  await signInAsAdmin(context, baseURL!);
  const visitor = await visitorBrowser(browser, baseURL!);
  const visitorStyle = async () => {
    await visitor.page.goto('/');
    return (await visitor.page.locator('head').innerHTML()).toLowerCase();
  };
  const name = `Test ${Date.now().toString(36)}`;
  try {
    await page.goto('/admin/theme');
    await page.getByRole('button', { name: /resin/i }).first().click();
    await page.getByLabel('Name').fill(name);
    await page
      .getByRole('button', { name: 'Save these colours as a theme' })
      .click();
    const saved = page.getByRole('listitem').filter({ hasText: name });
    await expect(saved).toBeVisible();
    // Keeping it changes nothing for visitors yet.
    expect(await visitorStyle()).not.toContain(
      palettes.resin.accent.toLowerCase(),
    );

    await saved
      .getByRole('button', { name: `Use ${name} on the site` })
      .click();
    await expect(saved.getByText('On the site now')).toBeVisible();
    // A visitor without an account gets the new colours on their next page.
    expect(await visitorStyle()).toContain(palettes.resin.accent.toLowerCase());

    await page
      .getByRole('button', { name: 'Back to the original colours' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Back to the original colours' }),
    ).toHaveCount(0);
    expect(await visitorStyle()).not.toContain(
      palettes.resin.accent.toLowerCase(),
    );
    // The editor shows the original palette again, not the last colours.
    await expect(saved.getByText('On the site now')).toHaveCount(0);

    await saved.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: name }),
    ).toHaveCount(0);
  } finally {
    await visitor.context.close();
  }
});
