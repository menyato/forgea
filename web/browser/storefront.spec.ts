import type { Page } from '@playwright/test';
import { finishSignUp } from './mail';
import { expect, test, newVisitor } from './fixtures';

const uniqueEmail = () =>
  `shopper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** On phones the header folds its links into a menu; open it first there. */
async function header(page: Page) {
  const menu = page.getByText('Menu', { exact: true });
  if (await menu.isVisible()) await menu.click();
  return page.getByRole('banner');
}

/** The seeded phone stand: every option has a default, so it can go straight into the cart. */
async function addPhoneStandToCart(page: Page) {
  await page.goto('/products/phone-stand');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Cart, [1-9][0-9]* items?$/ }),
  ).toBeVisible();
}

test('a visitor browses without an account, signs up at checkout and pays by transfer', async ({
  page,
}) => {
  await addPhoneStandToCart(page);

  // Checkout asks for an account, and says the cart is kept.
  await page.getByRole('link', { name: /^Cart/ }).click();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fcheckout/);
  await expect(page.getByText('Your cart is kept')).toBeVisible();

  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Name (optional)').fill('Rana Browser');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password').fill('correct-horse-battery-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await finishSignUp(page);

  // Back on checkout with the same cart; the name is already filled in.
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByLabel('Full name')).toHaveValue('Rana Browser');
  await page.getByLabel('Phone').fill('70 123 456');
  await page.getByLabel('Pick up from the studio (no delivery fee)').check();
  await page.getByLabel('Money transfer to our number').check();
  // In the page itself (the footer shows the WhatsApp number too).
  await expect(
    page.getByRole('main').getByText('+961 70 904 044'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page.getByText('Order placed')).toBeVisible();
  const orderNumber =
    (await page.locator('strong.font-mono').first().textContent()) ?? '';
  expect(orderNumber).toMatch(/^FG-\d{4}-\d{4,}$/);
  await expect(
    page.getByText(`Write ${orderNumber} in the transfer note`),
  ).toBeVisible();
  const whatsapp = page.getByRole('link', { name: /Chat with us on WhatsApp/ });
  await expect(whatsapp).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/96170904044\?text=/,
  );
  expect(
    decodeURIComponent((await whatsapp.getAttribute('href')) ?? ''),
  ).toContain(orderNumber);

  // My orders lists it; the next checkout remembers the phone.
  await (await header(page)).getByRole('link', { name: 'My orders' }).click();
  await expect(page.getByRole('article', { name: orderNumber })).toBeVisible();
  await addPhoneStandToCart(page);
  await page.goto('/checkout');
  await expect(page.getByLabel('Phone')).toHaveValue('70 123 456');

  // From My orders: the same order again, then cancelling it before the studio starts.
  await page.goto('/orders');
  const card = page.getByRole('article', { name: orderNumber });
  await card.getByRole('button', { name: 'Order again' }).click();
  await expect(page.getByText(/back in your cart/)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('article', { name: orderNumber })
    .getByRole('button', { name: 'Cancel this order' })
    .click();
  await expect(page.getByText('Your order is cancelled.')).toBeVisible();
  await expect(
    page
      .getByRole('article', { name: orderNumber })
      .getByRole('button', { name: 'Cancel this order' }),
  ).toHaveCount(0);
});

test('the theme button cycles Auto → Light → Dark and is remembered', async ({
  page,
}) => {
  await page.goto('/shop');
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', /.*/);

  await (
    await header(page)
  )
    .getByRole('button', { name: /^Theme: Auto/ })
    .click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  // The page switches at once; wait for the cookie to be saved before reloading.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/theme') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Theme: Light/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await saved;

  // Rendered by the server on the next visit: no flash of the wrong colors.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const background = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await (
    await header(page)
  )
    .getByRole('button', { name: /^Theme: Dark/ })
    .click();
  await expect(html).not.toHaveAttribute('data-theme', /.*/);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).not.toBe(background);
});

test('the theme button works without JavaScript', async ({ browser }) => {
  const context = await newVisitor(browser, { javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/shop');
  await (
    await header(page)
  )
    .getByRole('button', { name: /^Theme: Auto/ })
    .click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await context.close();
});

test('the home page and the shop show each product as its 3D model', async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.goto('/');
  // The print bed draws in WebGL; the products standing on it are also plain links.
  const onPlate = page.locator('figcaption').getByRole('link');
  await expect(onPlate.first()).toBeVisible();
  await expect(page.locator('figure canvas')).toBeVisible();
  // Its models download alongside three.js from the page's own code, not as <link rel=preload>
  // (the browser warns about preloads a later-starting scene doesn't use in time).
  expect(
    await page.locator('link[rel="preload"][href^="/media/"]').count(),
  ).toBe(0);
  // three.js's notice about the Clock @react-three/fiber still makes is filtered out.
  expect(warnings.filter((w) => w.includes('THREE.Clock'))).toEqual([]);
  // Nor are shaders re-checked outside development (Windows' compiler notes, X4122).
  expect(warnings.filter((w) => w.includes('Program Info Log'))).toEqual([]);

  // Other tests add products to this database; search for the seeded one.
  await page.goto('/shop?q=Phone%20stand');
  const card = page.getByRole('article').filter({ hasText: 'Phone stand' });
  // Models load as a card nears the screen; the test database's many categories can push it down.
  await card.scrollIntoViewIfNeeded();
  // The card's model is drawn once it has downloaded (the canvas fades in).
  await expect(card.locator('canvas')).toHaveClass(/opacity-100/);
  await card.getByRole('link', { name: 'Phone stand', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/phone-stand$/);
});
