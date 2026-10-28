import { expect, test } from './fixtures';
import { signInAsAdmin } from './admin-session';

test.skip(({ isMobile }) => isMobile, 'Back-office flow: one run is enough');

test('a lead becomes a quotation, the customer accepts it, and the order is invoiced and paid', async ({
  browser,
  page,
  context,
  baseURL,
}) => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `lead-${tag}@example.com`;

  // The customer has an account (a quotation is always for an account).
  const customer = await browser.newContext();
  const shopper = await customer.newPage();
  await shopper.goto('/register');
  await shopper.getByLabel('Name (optional)').fill('Lina Lead');
  await shopper.getByLabel('Email').fill(email);
  await shopper.getByLabel('Password').fill('correct-horse-battery-9');
  await shopper.getByRole('button', { name: 'Create account' }).click();
  await expect(shopper).not.toHaveURL(/\/register/);

  // Staff log the lead, then write a quotation from it.
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/leads');
  await page.getByLabel('Name', { exact: true }).fill('Lina Lead');
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('What do they need?')
    .fill('Twenty name tags for a wedding.');
  await page.getByRole('button', { name: 'Add the lead' }).click();
  await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Write a quotation' }).click();
  await expect(page.getByLabel('Customer account email')).toHaveValue(email);
  await page.getByLabel('Phone').fill('70 111 222');
  await page.getByLabel('Description').fill('Name tag, PLA, two colours');
  await page.getByLabel('Qty').fill('20');
  await page.getByLabel('Unit price').fill('2.50');
  await page.getByRole('button', { name: 'Create the quotation' }).click();
  await expect(page).toHaveURL(/\/admin\/quotations\/[0-9a-f-]{36}$/);
  const number = (
    await page.getByRole('heading', { level: 1 }).textContent()
  )?.match(/Q-\d{4}-\d{4}/)?.[0];
  expect(number).toBeTruthy();
  await page.getByRole('button', { name: 'Send to the customer' }).click();
  await expect(
    page.getByRole('button', { name: 'Send it again' }),
  ).toBeVisible();

  // The customer opens the link from the email and accepts.
  await shopper.goto(`/quotations/${number}`);
  await expect(shopper.getByText('Name tag, PLA, two colours')).toBeVisible();
  await shopper
    .getByRole('button', { name: 'Accept and place the order' })
    .click();
  await expect(shopper.getByText('Order placed')).toBeVisible();
  const orderNumber =
    (await shopper.locator('strong.font-mono').first().textContent()) ?? '';
  expect(orderNumber).toMatch(/^FG-/);
  await customer.close();

  // Staff invoice the order and record the transfer; the invoice is then paid.
  await page.goto(`/admin/orders?q=${orderNumber}`);
  await page.getByRole('link', { name: orderNumber }).first().click();
  await page.getByRole('button', { name: 'Invoice the order' }).click();
  await expect(
    page.getByRole('cell', { name: /INV\/\d{4}\/\d{5}/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record the payment' }).click();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
});
