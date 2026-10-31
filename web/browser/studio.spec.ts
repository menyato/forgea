import type { Page } from '@playwright/test';
import { signInAsAdmin } from './admin-session';
import { expect, test, newVisitor } from './fixtures';
import { lastEmailTo } from './mail';

/**
 * The studio's side of the work, button by button: a lead's whole life, a quotation confirmed
 * for someone without an account, a custom piece from deposit to credit note, the books, the
 * exchange rate and the quotation email's own words; and what the customer sees of each.
 */
test.skip(({ isMobile }) => isMobile, 'Studio journeys: one run is enough');

const tag = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Answers the next confirm() dialog. */
const answer = (page: Page, accept: boolean) =>
  page.once('dialog', (d) => void (accept ? d.accept() : d.dismiss()));

test('a lead from first contact to a confirmed order, for someone without an account', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const email = `walk-in-${tag()}@example.com`;
  await signInAsAdmin(context, baseURL!);

  // The quotation email in the studio's own words (put back to the standard ones at the end).
  await page.goto('/admin/settings');
  await page.getByLabel('Subject').fill('Your Forgea quote {number}, {name}');
  await page.getByRole('button', { name: 'Save the email' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.goto('/admin/leads');
  await page.getByLabel('Name', { exact: true }).fill('Nour Walk-in');
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('What do they need?')
    .fill('Twelve vases for a wedding.');
  await page.getByRole('button', { name: 'Add the lead' }).click();
  await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);

  // Notes, a follow-up done, a stage, lost and reopened.
  await page.getByLabel('Add a note').fill('Called: wants them in sand.');
  await page.getByRole('button', { name: 'Save the note' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Log' })
      .getByText('Called: wants them in sand.'),
  ).toBeVisible();
  const followUps = page.getByRole('region', { name: 'Follow-ups' });
  await page.getByLabel('About').fill('Send the prices');
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
  await page.getByLabel('When').fill(tomorrow);
  await page.getByRole('button', { name: 'Add the follow-up' }).click();
  await expect(followUps.getByText(/Send the prices/)).toBeVisible();
  await followUps.getByRole('button', { name: 'Done' }).click();
  await expect(followUps.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Contacted' }).click();
  await expect(page.getByRole('button', { name: 'Contacted' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Mark as lost' }).click();
  await expect(
    page.getByRole('region', { name: 'Stage' }).getByText(/^Lost: /),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reopen it' }).click();
  await expect(
    page.getByRole('button', { name: 'Mark as lost' }),
  ).toBeVisible();

  // A quotation with two lines, one with its printed size.
  await page.getByRole('link', { name: 'Write a quotation' }).click();
  await expect(page.getByLabel('Customer email')).toHaveValue(email);
  await page.getByLabel('Phone').fill('71 555 444');
  await page.getByLabel('Description').fill('Twist vase in sand');
  await page.getByLabel('Qty').fill('12');
  await page.getByLabel('Unit price').fill('18');
  const size = page.getByRole('group', { name: /Printed size, cm/ }).first();
  await size.getByLabel('Width').fill('9');
  await size.getByLabel('Depth').fill('9');
  await size.getByLabel('Height').fill('18');
  await page.getByRole('button', { name: 'Add a line' }).click();
  await page.getByLabel('Description').nth(1).fill('Gift wrapping');
  await page.getByLabel('Qty').nth(1).fill('12');
  await page.getByLabel('Unit price').nth(1).fill('1.50');
  await expect(page.getByText('Total $234.00')).toBeVisible();
  await page.getByRole('button', { name: 'Create the quotation' }).click();
  await expect(page).toHaveURL(/\/admin\/quotations\/[0-9a-f-]{36}$/);
  const number =
    (await page.getByRole('heading', { level: 1 }).textContent())?.match(
      /Q-\d{4}-\d{4}/,
    )?.[0] ?? '';
  expect(number).toBeTruthy();

  await page.getByRole('button', { name: 'Send to the customer' }).click();
  await expect(page.getByRole('button', { name: 'Send it again' })).toBeVisible(
    { timeout: 15_000 },
  );
  const mail = await lastEmailTo(email);
  expect(mail).toContain('Twist vase in sand');
  expect(mail).toContain('9 × 9 × 18 cm');
  expect(mail).toMatch(/\/q\/[A-Za-z0-9._-]+/);

  // They said yes on the phone: the studio confirms, which makes their account and the order.
  await page.getByRole('button', { name: 'Confirm: create the order' }).click();
  const created = page.getByText(/Order FG-[0-9A-Z]{10} created/);
  await expect(created).toBeVisible();
  const order =
    (await created.textContent())?.match(/FG-[0-9A-Z]{10}/)?.[0] ?? '';
  await page.goto(`/admin/orders?q=${order}`);
  await page.getByRole('link', { name: order }).first().click();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/Twist vase in sand/)).toBeVisible();

  // Another quotation, cancelled after saying no once to "are you sure".
  await page.goto(`/admin/quotations/new?email=${encodeURIComponent(email)}`);
  await page.getByLabel('Name for the order').fill('Nour Walk-in');
  await page.getByLabel('Phone').fill('71 555 444');
  await page.getByLabel('Description').fill('Spare vase');
  await page.getByLabel('Unit price').fill('18');
  await page.getByRole('button', { name: 'Create the quotation' }).click();
  await expect(page).toHaveURL(/\/admin\/quotations\/[0-9a-f-]{36}$/);
  answer(page, false);
  await page.getByRole('button', { name: 'Cancel the quotation' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel the quotation' }),
  ).toBeVisible();
  answer(page, true);
  await page.getByRole('button', { name: 'Cancel the quotation' }).click();
  await expect(
    page.getByRole('region', { name: 'Next' }).getByText('Cancelled.'),
  ).toBeVisible();

  // The standard email words again.
  await page.goto('/admin/settings');
  await page.getByLabel('Subject').fill('');
  await page.getByRole('button', { name: 'Save the email' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

test('a custom piece: deposit, production, pickup, then a credit note; the customer follows every step', async ({
  page,
  browser,
  context,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const email = `custom-${tag()}@example.com`;
  const title = `Drone frame ${tag()}`;

  // The customer asks.
  const shopper = await newVisitor(browser);
  const c = await shopper.newPage();
  await c.goto('/register');
  await c.getByLabel('Name (optional)').fill('Rami Custom');
  await c.getByLabel('Email').fill(email);
  await c.getByLabel('Password').fill('correct-horse-battery-9');
  await c.getByRole('button', { name: 'Create account' }).click();
  await expect(c).not.toHaveURL(/\/register/);
  await c.goto('/custom');
  await c.getByLabel('What is it?').fill(title);
  await c
    .getByLabel('Describe it')
    .fill('A 5-inch frame in carbon-filled PETG.');
  await c.getByRole('button', { name: 'Send request' }).click();
  await expect(c.getByText('Request sent.')).toBeVisible();
  const requestUrl = c.url();

  // The studio quotes $40.
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/requests?status=SUBMITTED');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByLabel('Price (USD, for everything)').fill('40');
  await page.getByRole('button', { name: 'Send the quote' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // The customer accepts, cash at pickup: the deposit is due first.
  await c.goto(requestUrl);
  await c.getByLabel('Phone').fill('70 333 222');
  await c.getByLabel('Pick up from the studio (no delivery fee)').check();
  await c.getByLabel('Cash on delivery').check();
  await c.getByRole('button', { name: 'Accept and place the order' }).click();
  await expect(c.getByText('Order placed')).toBeVisible();
  const order =
    (await c.locator('strong.font-mono').first().textContent()) ?? '';
  await c.goto('/orders');
  const card = c.getByRole('article', { name: order });
  await expect(card.getByText(/Deposit of \$\d+\.\d\d needed/)).toBeVisible();

  // The studio invoices the deposit, records the transfer, confirms.
  await page.goto(`/admin/orders?q=${order}`);
  await page.getByRole('link', { name: order }).first().click();
  const invoices = page.getByRole('region', { name: 'Invoices' });
  await page.getByRole('button', { name: 'Invoice the deposit' }).click();
  await expect(
    invoices.getByRole('row', { name: /Deposit.*Not paid/ }),
  ).toBeVisible();
  await page.getByLabel('How').selectOption('BANK');
  await page.getByRole('button', { name: 'Record the payment' }).click();
  await expect(
    invoices.getByRole('row', { name: /Deposit.*Paid/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Deposit received, confirm' }).click();
  await expect(
    page.getByRole('button', { name: 'Start production' }),
  ).toBeVisible();
  // Confirming doesn't invoice the deposit a second time.
  await expect(invoices.getByRole('row', { name: /Deposit/ })).toHaveCount(1);
  for (const step of [
    'Start production',
    'Mark as ready',
    'Mark as delivered',
  ]) {
    await page.getByRole('button', { name: step }).click();
    await expect(page.getByRole('button', { name: step })).toHaveCount(0);
  }
  // Handed over: the rest is invoiced and the cash recorded.
  await expect(
    invoices.getByRole('row', { name: /INV\/.*Invoice.*\$0\.00 Paid/ }),
  ).toBeVisible();

  // The piece came back broken: the final invoice is credited, after "are you sure".
  answer(page, true);
  // Oldest first: the last one is the final invoice.
  const creditFor = page.getByLabel('Credit note for');
  await creditFor.selectOption({
    index: (await creditFor.locator('option').count()) - 1,
  });
  await page.getByRole('button', { name: 'Issue a credit note' }).click();
  await expect(
    invoices.getByRole('row', { name: /Credit note/ }),
  ).toBeVisible();
  await expect(invoices.getByText(/credited by RINV\//)).toHaveCount(1);
  // What the customer paid at pickup goes back: the refund is recorded against the credit note.
  // Both invoices are paid: the credit note is the only thing open, with its amount filled in.
  await expect(
    page.getByLabel('Payment or refund for').locator('option:checked'),
  ).toHaveText(/^RINV\/.*\(refund \$\d+\.\d\d\)$/);
  await page.getByLabel('How').selectOption('CASH');
  await page.getByRole('button', { name: 'Record the payment' }).click();
  await expect(
    invoices.getByRole('row', { name: /Credit note.*Settled/ }),
  ).toBeVisible();
  await page.goto('/admin/accounting?tab=credit');
  await expect(page.getByRole('cell', { name: order })).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.getByText('invoice.credit-note').first()).toBeVisible();

  // The customer sees it all.
  await c.reload();
  await expect(card.getByText('Delivered').first()).toBeVisible();
  const theirs = card.getByRole('region', { name: 'Invoices' });
  await expect(theirs.getByText(/deposit/)).toBeVisible();
  await expect(theirs.getByText(/credit note/)).toBeVisible();
  await shopper.close();
});

test('the books take a manual entry whose cents add up; a new exchange rate reaches the shop', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/accounting/books');
  await page.getByLabel('What it is').fill(`Owner puts in cash ${tag()}`);
  const accounts = page.getByLabel('Account');
  const options = await accounts.first().locator('option').allTextContents();
  await accounts.nth(0).selectOption({ label: options[0]! });
  await page.getByLabel('Debit').nth(0).fill('30.30');
  await accounts.nth(1).selectOption({ label: options[1]! });
  await page.getByLabel('Credit').nth(1).fill('10.10');
  await page.getByRole('button', { name: 'Add a line' }).click();
  await accounts.nth(2).selectOption({ label: options[1]! });
  await page.getByLabel('Credit').nth(2).fill('20.20');
  await expect(page.getByText('Debits 30.30 · Credits 30.30')).toBeVisible();
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // A new LBP rate shows on product pages at once.
  await page.goto('/admin/currencies');
  const lbp = page.getByRole('region', { name: /LBP/ });
  await lbp.getByLabel(/New rate/).fill('90000');
  await lbp.getByRole('button', { name: 'Set the rate' }).click();
  await expect(lbp.getByText('1 USD = 90,000 LBP')).toBeVisible();
  await page.goto('/products/phone-stand');
  const usd = Number(
    (
      await page.locator('[aria-live="polite"] p').first().textContent()
    )?.replace(/[^0-9.]/g, ''),
  );
  const lbpText = (await page.getByText(/≈ LBP/).textContent()) ?? '';
  const shown = Number(lbpText.replace(/[^0-9]/g, ''));
  // LBP rounds to 5,000: within one step of USD × 90,000.
  expect(Math.abs(shown - usd * 90_000)).toBeLessThanOrEqual(5_000);
  // Back to the usual rate.
  await page.goto('/admin/currencies');
  await page
    .getByRole('region', { name: /LBP/ })
    .getByLabel(/New rate/)
    .fill('89500');
  await page
    .getByRole('region', { name: /LBP/ })
    .getByRole('button', { name: 'Set the rate' })
    .click();
  await expect(
    page.getByRole('region', { name: /LBP/ }).getByText('1 USD = 89,500 LBP'),
  ).toBeVisible();
});

test('filament: a delivery comes in, an order going into production takes its grams, the Business page shows the sale', async ({
  page,
  browser,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  // A customer orders a phone stand in forest green, to pick up.
  const shopper = await newVisitor(browser);
  const c = await shopper.newPage();
  await c.goto('/register');
  await c.getByLabel('Email').fill(`stand-${tag()}@example.com`);
  await c.getByLabel('Password').fill('correct-horse-battery-9');
  await c.getByRole('button', { name: 'Create account' }).click();
  await expect(c).not.toHaveURL(/\/register/);
  await c.goto('/products/phone-stand');
  await c.getByRole('radio', { name: 'Forest green' }).check({ force: true });
  await c.getByRole('button', { name: 'Add to cart' }).click();
  await expect(c.getByText('In your cart.')).toBeVisible();
  await c.goto('/checkout');
  await c.getByLabel('Full name').fill('Hadi Stand');
  await c.getByLabel('Phone').fill('70 444 555');
  await c.getByLabel('Pick up from the studio (no delivery fee)').check();
  await c.getByLabel('Cash on delivery').check();
  await c.getByRole('button', { name: 'Place order' }).click();
  await expect(c.getByText('Order placed')).toBeVisible();
  const order =
    (await c.locator('strong.font-mono').first().textContent()) ?? '';
  await shopper.close();

  // The studio records three spools of that filament.
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/stock');
  const record = page.getByRole('region', {
    name: 'Record filament in or out',
  });
  await record.getByLabel('Material').selectOption({ label: 'PLA (PLA)' });
  await record.getByLabel('Colour (optional)').fill('Forest green');
  await record.getByLabel('What happened').selectOption('RECEIVED');
  await record.getByLabel('Grams').fill('3000');
  await record.getByLabel('Note (optional)').fill(`3 spools ${order}`);
  await record.getByRole('button', { name: 'Record' }).click();
  await expect(record.getByText('Saved')).toBeVisible();
  const moves = page.getByRole('region', { name: 'Latest movements' });
  await expect(
    moves.getByRole('row', {
      name: new RegExp(
        `Delivery received PLA Forest green \\+3,000 g 3 spools ${order}`,
      ),
    }),
  ).toBeVisible();

  // Into production: the order's grams go out of stock, once.
  await page.goto(`/admin/orders?q=${order}`);
  await page.getByRole('link', { name: order }).first().click();
  for (const step of ['Confirm the order', 'Start production']) {
    await page.getByRole('button', { name: step }).click();
    await expect(page.getByRole('button', { name: step })).toHaveCount(0);
  }
  await page.goto('/admin/stock');
  await expect(
    moves.getByRole('row', {
      name: new RegExp(
        `Order in production PLA Forest green −\\d+ g .*${order}`,
      ),
    }),
  ).toHaveCount(1);

  // Picked up and paid: the Business page counts it.
  await page.goto(`/admin/orders?q=${order}`);
  await page.getByRole('link', { name: order }).first().click();
  for (const step of ['Mark as ready', 'Mark as delivered']) {
    await page.getByRole('button', { name: step }).click();
    await expect(page.getByRole('button', { name: step })).toHaveCount(0);
  }
  await page.goto('/admin/insights');
  await expect(
    page.getByRole('heading', { name: 'Business', level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Best sellers' })
      .getByText('Phone stand')
      .first(),
  ).toBeVisible();
});
