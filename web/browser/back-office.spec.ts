import { expect, test, newVisitor } from './fixtures';
import { finishSignUp } from './mail';
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
  const customer = await newVisitor(browser);
  const shopper = await customer.newPage();
  await shopper.goto('/register');
  await shopper.getByLabel('Name (optional)').fill('Lina Lead');
  await shopper.getByLabel('Email').fill(email);
  await shopper.getByLabel('Password').fill('correct-horse-battery-9');
  await shopper.getByRole('button', { name: 'Create account' }).click();
  await finishSignUp(shopper);
  await expect(shopper).not.toHaveURL(/\/register/);

  // Staff log the lead, then write a quotation from it.
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/leads');
  await page.getByRole('link', { name: 'New lead' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Lina Lead');
  await page.getByLabel('Email').fill(email);
  await page
    .getByLabel('What do they need?')
    .fill('Twenty name tags for a wedding.');
  await page.getByRole('button', { name: 'Add the lead' }).click();
  await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Write a quotation' }).click();
  await expect(page.getByLabel('Customer email')).toHaveValue(email);
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
    // Sending writes the whole quotation email: slower when the full suite runs at once.
  ).toBeVisible({ timeout: 15_000 });

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
  // Drafted first, due in two weeks: no number until it is posted.
  const invoices = page.getByRole('region', { name: 'Invoices' });
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await invoices
    .getByLabel('Invoice', { exact: true })
    .selectOption('final-invoice');
  await invoices.getByLabel('Due date').fill(due);
  await invoices.getByRole('button', { name: 'Save as a draft' }).click();
  await expect(
    invoices.getByRole('row', { name: /Draft.*Draft/ }),
  ).toBeVisible();
  await expect(invoices.getByRole('cell', { name: due })).toBeVisible();
  // Its own page still changes its dates.
  const orderPage = page.url();
  await invoices.getByRole('link', { name: 'Draft' }).click();
  await expect(
    page.getByRole('heading', { name: 'Draft invoice', level: 1 }),
  ).toBeVisible();
  const later = new Date(Date.now() + 21 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const draftPanel = page.getByRole('region', { name: 'Draft' });
  await draftPanel.getByLabel('Due date').fill(later);
  await draftPanel.getByRole('button', { name: 'Save the dates' }).click();
  await expect(draftPanel.getByText('Saved', { exact: true })).toBeVisible();
  await page.goto(orderPage);
  await expect(invoices.getByRole('cell', { name: later })).toBeVisible();
  await invoices.getByRole('button', { name: 'Post it' }).click();
  await expect(
    page.getByRole('cell', { name: /INV\/\d{4}\/\d{5}/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record the payment' }).click();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
});

test('a customer declines a quotation; the lead waits for the team, who decide it is not lost', async ({
  browser,
  page,
  context,
  baseURL,
}) => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `decline-${tag}@example.com`;
  const customer = await newVisitor(browser);
  const shopper = await customer.newPage();
  await shopper.goto('/register');
  await shopper.getByLabel('Email').fill(email);
  await shopper.getByLabel('Password').fill('correct-horse-battery-9');
  await shopper.getByRole('button', { name: 'Create account' }).click();
  await finishSignUp(shopper);

  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/leads/new');
  await page.getByLabel('Name', { exact: true }).fill('Omar Decline');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('What do they need?').fill('A shop sign, 60 cm wide.');
  await page.getByRole('button', { name: 'Add the lead' }).click();
  await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
  const leadUrl = page.url();
  await page.getByRole('link', { name: 'Write a quotation' }).click();
  await page.getByLabel('Phone').fill('70 333 444');
  await page.getByLabel('Description').fill('Shop sign, 60 cm');
  await page.getByLabel('Qty').fill('1');
  await page.getByLabel('Unit price').fill('120.00');
  await page.getByRole('button', { name: 'Create the quotation' }).click();
  await expect(page).toHaveURL(/\/admin\/quotations\/[0-9a-f-]{36}$/);
  const number = (
    await page.getByRole('heading', { level: 1 }).textContent()
  )?.match(/Q-\d{4}-\d{4}/)?.[0];
  await page.getByRole('button', { name: 'Send to the customer' }).click();
  await expect(page.getByRole('button', { name: 'Send it again' })).toBeVisible(
    { timeout: 15_000 },
  );

  // Sent: the lead is in Quoted, and its log says so.
  await page.goto(leadUrl);
  await expect(page.getByText(`Quotation ${number} sent`)).toBeVisible();

  // The customer declines, with a reason.
  await shopper.goto(`/quotations/${number}`);
  await shopper.getByText('Not right for you? Decline it').click();
  await shopper.getByLabel('Why not? (optional)').fill('Too big for our wall');
  await shopper.getByRole('button', { name: 'Decline this quotation' }).click();
  await expect(shopper.getByText('You declined this quotation')).toBeVisible();
  await customer.close();

  // The lead waits for the team: they keep it open.
  await page.reload();
  const decision = page.getByRole('status', { name: 'Needs your decision' });
  await expect(decision).toContainText('Too big for our wall');
  await decision
    .getByRole('button', { name: 'Not lost: keep it open' })
    .click();
  await expect(decision).toBeHidden();
  await expect(page.getByText('Kept open.')).toBeVisible();

  // The lead leads to its quotation and its customer, with everything they did.
  const related = page.getByRole('navigation', { name: 'Related' });
  await expect(
    related.getByRole('link', { name: `Quotation ${number}` }),
  ).toBeVisible();
  await related.getByRole('link', { name: `Customer: ${email}` }).click();
  // No name on the account: the one from their lead.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Omar Decline',
  );
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByText('Quotations (1)')).toBeVisible();
  await expect(page.getByRole('link', { name: number! })).toBeVisible();
  await expect(page.getByText('Leads (1)')).toBeVisible();
  // Their sign-in is tracked: on what, and that they are still signed in.
  await expect(page.getByText('Sign-ins (1)')).toBeVisible();
  await expect(page.getByText('Signed in now')).toBeVisible();

  // The Overview counts customers too.
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByText('signed in this week')).toBeVisible();
});
