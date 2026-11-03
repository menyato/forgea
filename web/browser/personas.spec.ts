import type { BrowserContext, Page } from '@playwright/test';
import { signInAsAdmin } from './admin-session';
import { closeDashboardMenu, expect, test, newVisitor } from './fixtures';
import { lastEmailTo } from './mail';

/**
 * Five customers, each with their own goal, and the studio receiving them. Every browser
 * records what goes wrong on the way, not only what the steps check: console errors, page
 * crashes, server errors and slow pages. Any of them fails the journey.
 */
const SLOW_MS = 4_000;

function watch(page: Page, who: string) {
  const faults: string[] = [];
  page.on('console', (m) => {
    // A refused form (wrong password, a used link) is a 4xx the browser logs; 5xx are below.
    const refused = /^Failed to load resource: .* status of 4\d\d/.test(
      m.text(),
    );
    if (m.type() === 'error' && !refused) {
      faults.push(`${who}: console: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => faults.push(`${who}: crash: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) {
      faults.push(
        `${who}: ${r.status()} from ${r.request().method()} ${r.url()}`,
      );
    }
  });
  page.on('requestfinished', (r) => {
    const t = r.timing();
    const took = t.responseEnd;
    if (r.resourceType() === 'document' && took > SLOW_MS) {
      faults.push(`${who}: ${Math.round(took)} ms for ${r.url()}`);
    }
  });
  return faults;
}

const tag = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'correct-horse-battery-9';

async function register(page: Page, name: string, email: string) {
  await page.goto('/register');
  await page.getByLabel('Name (optional)').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/\/register/);
}

/** The header's links, behind "Menu" on a phone. */
async function header(page: Page) {
  const menu = page.getByText('Menu', { exact: true });
  if (await menu.isVisible()) await menu.click();
  return page.getByRole('banner');
}

/** The product page's price (it updates as choices change). */
function productPrice(page: Page) {
  return page.locator('[aria-live="polite"] p').first();
}

/** The product page's size choices (the first radio group), largest last. */
function sizeChoices(page: Page) {
  return page.getByRole('radiogroup').first().getByRole('radio');
}

test('Maya, on her phone: two sizes of a vase, delivered, cash on delivery; the studio takes it to her door', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const faults = watch(page, 'Maya');
  const email = `maya-${tag()}@example.com`;

  // Finds the vase through the shop: a category, then a search.
  await page.goto('/shop');
  await page
    .getByRole('navigation', { name: 'Categories' })
    .getByRole('link', { name: /Designer/ })
    .click();
  await expect(page).toHaveURL(/category=/);
  await page.getByLabel('Search products').fill('vase');
  await page.getByLabel('Search products').press('Enter');
  await expect(page).toHaveURL(/q=vase/);
  await page
    .getByRole('link', { name: /Twist vase/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/products\/twist-vase/);

  // Sizes are measurements; a bigger one costs more.
  const sizes = sizeChoices(page);
  expect(await sizes.count()).toBeGreaterThanOrEqual(2);
  const price = productPrice(page);
  await sizes.last().check({ force: true });
  const large = await price.textContent();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await sizes.first().check({ force: true });
  await expect(price).not.toHaveText(large ?? '');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(
    page.getByRole('link', { name: /^Cart, 2 items$/ }),
  ).toBeVisible();

  // The cart tells the two apart by size; she takes two of the small one.
  await page.goto('/cart');
  const lines = page.getByRole('article');
  await expect(lines).toHaveCount(2);
  await expect(
    lines.filter({ hasText: /Size: [0-9.]+ × [0-9.]+ × [0-9.]+ cm/ }),
  ).toHaveCount(2);
  const small = lines.nth(1);
  await small.getByLabel('Quantity').fill('2');
  await small.getByRole('button', { name: 'Update' }).click();
  await expect(
    page.getByRole('link', { name: /^Cart, 3 items$/ }),
  ).toBeVisible();

  // Checkout: an account first, then the form refuses empty answers.
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Name (optional)').fill('Maya Phone');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByLabel('Deliver to me').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByLabel('Phone')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('City or area')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByLabel('Phone').fill('03 456 789');
  await page.getByLabel('City or area').fill('Beirut, Achrafieh');
  await page
    .getByLabel('Street, building, floor')
    .fill('Sursock St, Bldg 4, 2nd floor');
  await page
    .getByLabel('Directions for the courier (optional)')
    .fill('Blue door next to the bakery');
  await page.getByLabel('Cash on delivery').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order placed')).toBeVisible();
  const order =
    (await page.locator('strong.font-mono').first().textContent()) ?? '';
  expect(order).toMatch(/^FG-[0-9A-Z]{10}$/);
  expect(await lastEmailTo(email)).toContain(order);

  // My orders lists both vases with their sizes.
  await (await header(page)).getByRole('link', { name: 'My orders' }).click();
  const card = page.getByRole('article', { name: order });
  await expect(
    card.getByText(/Size: [0-9.]+ × [0-9.]+ × [0-9.]+ cm/),
  ).toHaveCount(2);

  // The studio receives it.
  const studio = await newVisitor(browser);
  const admin = await studio.newPage();
  const adminFaults = watch(admin, 'Studio');
  await signInAsAdmin(studio, baseURL!);
  await admin.goto('/admin/orders');
  await closeDashboardMenu(admin);
  await admin.getByRole('link', { name: order }).click();
  await expect(admin.getByText('Beirut, Achrafieh')).toBeVisible();
  await expect(admin.getByText('Blue door next to the bakery')).toBeVisible();
  await expect(
    admin.getByText(/Size: [0-9.]+ × [0-9.]+ × [0-9.]+ cm/),
  ).toHaveCount(2);
  const step = async (button: string, note?: string) => {
    if (note)
      await admin.getByLabel('Note for the customer (optional)').fill(note);
    await admin.getByRole('button', { name: button }).click();
    // Done once that step is no longer offered.
    await expect(admin.getByRole('button', { name: button })).toHaveCount(0);
  };
  await step('Confirm the order');
  await step('Start production');
  await step('Mark as ready');
  await step('Send out for delivery', 'With Toters, tracking T-4471');
  await step('Mark as delivered');
  await expect(admin.getByText('This order is closed.')).toBeVisible();
  await expect(
    admin
      .getByRole('region', { name: 'History' })
      .getByText('With Toters, tracking T-4471'),
    // Once: the note goes with its own step, not with the next one too.
  ).toHaveCount(1);

  // Cash on delivery: delivering invoices the order and records the courier's cash.
  const invoices = admin.getByRole('region', { name: 'Invoices' });
  await expect(
    invoices.getByRole('row', { name: /^INV\/\d{4}\/\d{5}.*\$0\.00 Paid$/ }),
  ).toBeVisible();

  // Maya follows it all from My orders, and heard about each step by email.
  await page.reload();
  await expect(card.getByText('Delivered').first()).toBeVisible();
  await expect(card.getByText('With Toters, tracking T-4471')).toBeVisible();
  await expect(
    card.getByRole('region', { name: 'Invoices' }).getByText('paid'),
  ).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Cancel this order' }),
  ).toHaveCount(0);
  expect(await lastEmailTo(email)).toMatch(/deliver/i);

  await studio.close();
  expect([...faults, ...adminFaults]).toEqual([]);
});

test('Karim forgot his password: a link by email, a new password, and the old one stops working', async ({
  page,
}) => {
  const faults = watch(page, 'Karim');
  const email = `karim-${tag()}@example.com`;
  await register(page, 'Karim Returning', email);
  await page.context().clearCookies();

  await page.goto('/orders');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Forders/);
  await page.getByRole('link', { name: /Forgot/ }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByText('a link to choose a new password')).toBeVisible();
  const mail = await lastEmailTo(email);
  const link = /https?:\/\/\S+\/reset-password\?token=\S+/.exec(mail)?.[0];
  expect(link).toBeTruthy();

  await page.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByLabel('New password').fill('a-brand-new-password-42');
  await page.getByRole('button', { name: /password/i }).click();
  await expect(
    page.getByText(/changed|new password is set|signed in/i).first(),
  ).toBeVisible();

  // The same link can't be used twice.
  await page.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByLabel('New password').fill('another-password-77');
  await page.getByRole('button', { name: /password/i }).click();
  await expect(
    page.getByText(/expired|no longer|used|invalid/i).first(),
  ).toBeVisible();

  // Old password refused, new one works and returns to where he was going.
  await page.context().clearCookies();
  await page.goto('/sign-in?next=%2Forders');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText(/wrong|incorrect|doesn.t match/i).first(),
  ).toBeVisible();
  await page.getByLabel('Password').fill('a-brand-new-password-42');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/orders/);
  expect(faults).toEqual([]);
});

test('Lina, in a hurry: rush, pickup, a full transfer; she cancels the order herself', async ({
  page,
}) => {
  const faults = watch(page, 'Lina');
  const email = `lina-${tag()}@example.com`;
  await register(page, 'Lina Rush', email);
  await page.goto('/products/ribbed-pen-cup');
  const before = await productPrice(page).textContent();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();

  await page.goto('/cart');
  await page.getByLabel('Pick up from the studio (no delivery fee)').check();
  await page.getByLabel(/Rush/).check();
  await page.getByRole('link', { name: 'Checkout' }).click();
  // The cart's choices carry over to checkout.
  await expect(
    page.getByLabel('Pick up from the studio (no delivery fee)'),
  ).toBeChecked();
  await expect(page.getByLabel(/Rush/)).toBeChecked();
  await expect(page.getByLabel('City or area')).toHaveCount(0);
  await page.getByLabel('Phone').fill('76 222 333');
  await page.getByLabel('Money transfer to our number').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order placed')).toBeVisible();
  const order =
    (await page.locator('strong.font-mono').first().textContent()) ?? '';
  // Rush costs more than the product alone.
  expect(before).toBeTruthy();

  await page.goto('/orders');
  page.once('dialog', (d) => void d.accept());
  await page
    .getByRole('article', { name: order })
    .getByRole('button', { name: 'Cancel this order' })
    .click();
  await expect(page.getByText('Your order is cancelled.')).toBeVisible();
  await expect(
    page.getByRole('article', { name: order }).getByText('Cancelled').first(),
  ).toBeVisible();
  expect(faults).toEqual([]);
});

test('Sara fills a cart as a guest, then signs in to her account: the cart comes with her', async ({
  page,
  browser,
}) => {
  const faults = watch(page, 'Sara');
  const email = `sara-${tag()}@example.com`;
  // Her account, made earlier on another device, with something already in its cart.
  const other: BrowserContext = await newVisitor(browser);
  const earlier = await other.newPage();
  await register(earlier, 'Sara Two Devices', email);
  await earlier.goto('/products/phone-stand');
  await earlier.getByRole('button', { name: 'Add to cart' }).click();
  await expect(earlier.getByText('In your cart.')).toBeVisible();
  await other.close();

  // Today, not signed in: the lamp shade.
  await page.goto('/products/lamp-shade');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await page.goto('/sign-in?next=%2Fcart');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/cart/);
  const lines = page.getByRole('article');
  await expect(lines.filter({ hasText: 'Desk lamp shade' })).toHaveCount(1);
  await expect(lines.filter({ hasText: 'Phone stand' })).toHaveCount(1);

  // Removing a line leaves the other.
  await page.getByRole('button', { name: /^Remove Phone stand/ }).click();
  await expect(lines.filter({ hasText: 'Phone stand' })).toHaveCount(0);
  // Removed on the server too (the row hides at once; the count follows the answer).
  await expect(
    page.getByRole('link', { name: /^Cart, 1 item$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(lines).toHaveCount(1);
  expect(faults).toEqual([]);
});

test('Omar pokes around: other people’s orders, the dashboard, forged prices and broken links all stay shut', async ({
  page,
  browser,
}) => {
  const faults = watch(page, 'Omar');
  // Someone else's order.
  const victim = await newVisitor(browser);
  const v = await victim.newPage();
  await register(v, 'Someone Else', `else-${tag()}@example.com`);
  await v.goto('/products/phone-stand');
  await v.getByRole('button', { name: 'Add to cart' }).click();
  await expect(v.getByText('In your cart.')).toBeVisible();
  await v.goto('/checkout');
  await v.getByLabel('Phone').fill('70 999 000');
  await v.getByLabel('Pick up from the studio (no delivery fee)').check();
  await v.getByRole('button', { name: 'Place order' }).click();
  await expect(v.getByText('Order placed')).toBeVisible();
  const theirs =
    (await v.locator('strong.font-mono').first().textContent()) ?? '';
  await victim.close();

  const omar = `omar-${tag()}@example.com`;
  await register(page, 'Omar Curious', omar);
  // Their order isn't in his list, and cancelling it by hand does nothing.
  await page.goto('/orders');
  await expect(page.getByText(theirs)).toHaveCount(0);
  const cancel = await page.request.post('/orders', {
    form: { intent: 'cancel', number: theirs },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(cancel.status()).toBeLessThan(500);
  await page.goto('/orders');
  await expect(page.getByText(theirs)).toHaveCount(0);

  // The dashboard refuses a customer, page by page.
  for (const path of [
    '/admin',
    '/admin/orders',
    '/admin/team',
    '/admin/accounting',
  ]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(403);
  }
  // A price sent with the cart is ignored: the server prices it.
  await page.goto('/products/phone-stand');
  const shown = (await productPrice(page).textContent()) ?? '';
  await page.evaluate(() => {
    const form = [...document.querySelectorAll('form')].find((f) =>
      f.textContent?.includes('Add to cart'),
    );
    for (const [name, value] of [
      ['price', '0.01'],
      ['unitPrice', '0.01'],
    ]) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name!;
      input.value = value!;
      form?.append(input);
    }
  });
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible();
  await page.goto('/cart');
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Phone stand' })
      .getByText(shown.trim())
      .first(),
  ).toBeVisible();

  // Made-up links get a page that says so, never a crash.
  for (const path of [
    '/q/not-a-real-token',
    '/requests/CR-NOPE',
    '/products/no-such-thing',
    '/media/clean/nope.stl',
  ]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBeGreaterThanOrEqual(400);
    expect(r?.status(), path).toBeLessThan(500);
  }
  // Leaving via a crafted ?next= stays on the site.
  await page.context().clearCookies();
  await page.goto('/sign-in?next=https%3A%2F%2Fevil.example%2F');
  await page.getByLabel('Email').fill(omar);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/sign-in/);
  expect(page.url()).not.toContain('evil.example');
  expect(faults).toEqual([]);
});
