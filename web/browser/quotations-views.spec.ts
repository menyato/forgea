import { signInAsAdmin } from './admin-session';
import { closeDashboardMenu, dashboardMenu, expect, test } from './fixtures';
import { lastEmailTo } from './mail';

const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

test('a quotation reaches someone without an account by email, with sizes, and they accept it after signing up', async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  await signInAsAdmin(context, baseURL!);
  const email = uniqueEmail('guest');

  await page.goto('/admin/quotations/new');
  await page.getByLabel('Customer email').fill(email);
  await page.getByLabel('Name for the order').fill('Nour Saleh');
  await page.getByLabel('Phone').fill('70 555 666');
  await page.getByLabel('Description').fill('Display stand');
  await page.getByLabel('Unit price').fill('25.00');
  await page.getByLabel('Width').fill('30');
  await page.getByLabel('Depth').fill('12.5');
  await page.getByLabel('Height').fill('18');
  await page.getByRole('button', { name: 'Create the quotation' }).click();
  await expect(page).toHaveURL(/\/admin\/quotations\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Send to the customer' }).click();
  await expect(
    page.getByRole('button', { name: 'Send it again' }),
  ).toBeVisible();

  // The email holds the whole quotation and a private link.
  const mail = await lastEmailTo(email);
  expect(mail).toContain('Dear Nour Saleh,');
  expect(mail).toContain('Display stand, 30 × 12.5 × 18 cm');
  const link = /https?:\/\/[^\s]+\/q\/[\w.%-]+/.exec(mail)?.[0];
  expect(link).toBeTruthy();

  // Someone without an account opens it, in their own browser.
  const guest = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      'cf-connecting-ip': `198.18.${Math.floor(Math.random() * 254) + 1}.91`,
    },
  });
  const visitor = await guest.newPage();
  try {
    await visitor.goto(new URL(link!).pathname);
    await expect(
      visitor.getByRole('heading', { name: /^Quotation Q-/ }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('cell', { name: '30 × 12.5 × 18 cm' }),
    ).toBeVisible();
    await expect(
      visitor.getByText(`create a free account with ${email}`),
    ).toBeVisible();

    // Accepting asks them to sign in; they create an account and come straight back.
    await visitor
      .getByRole('button', { name: 'Accept and place the order' })
      .click();
    await expect(visitor).toHaveURL(/\/sign-in/);
    await visitor.getByRole('link', { name: 'Create an account' }).click();
    await visitor.getByLabel('Name (optional)').fill('Nour Saleh');
    await visitor.getByLabel('Email').fill(email);
    await visitor.getByLabel('Password').fill('correct-horse-battery-9');
    await visitor.getByRole('button', { name: 'Create account' }).click();
    await expect(visitor).toHaveURL(/\/q\//);
    await visitor
      .getByRole('button', { name: 'Accept and place the order' })
      .click();
    await expect(
      visitor.getByRole('heading', { name: /Thank you|Order/ }).first(),
    ).toBeVisible();
  } finally {
    await guest.close();
  }
});

test('the dashboard menu folds into groups; lists split into tabs and boards', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/orders');
  let menu = await dashboardMenu(page);

  // Groups like apps; the current page's group is open.
  for (const group of [
    'Sales',
    'Orders',
    'Accounting',
    'Catalog',
    'Settings',
  ]) {
    await expect(
      menu.locator('summary').filter({ hasText: group }),
    ).toBeVisible();
  }
  await expect(
    menu.getByRole('link', { name: 'Orders', exact: true }),
  ).toBeVisible();
  // Folding a group away is remembered on the next page.
  await menu.locator('summary').filter({ hasText: 'Catalog' }).click();
  await expect(
    menu.getByRole('link', { name: 'Products', exact: true }),
  ).toBeHidden();
  await page.goto('/admin/leads');
  menu = await dashboardMenu(page);
  await expect(
    menu.getByRole('link', { name: 'Leads', exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole('link', { name: 'Products', exact: true }),
  ).toBeHidden();
  await menu.locator('summary').filter({ hasText: 'Catalog' }).click();
  await expect(
    menu.getByRole('link', { name: 'Products', exact: true }),
  ).toBeVisible();

  // Leads: new ones apart from the pipeline.
  const leadTabs = page.getByRole('navigation', { name: 'Lead groups' });
  await expect(leadTabs.getByRole('link', { name: /^New/ })).toBeVisible();
  await closeDashboardMenu(page);
  await leadTabs.getByRole('link', { name: 'Assigned to me' }).click();
  await expect(page).toHaveURL(/tab=mine/);

  // Orders: grouped by what to do next, or as a board by status.
  await page.goto('/admin/orders');
  const orderTabs = page.getByRole('navigation', { name: 'Order groups' });
  await expect(
    orderTabs.getByRole('link', { name: /^To confirm/ }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('group', { name: 'Show as' })
    .getByRole('link', { name: 'Board' })
    .click();
  await expect(page).toHaveURL(/view=board/);
  await expect(
    page.getByRole('region', { name: 'Waiting for deposit' }),
  ).toBeVisible();

  await page.goto('/admin/quotations?view=board');
  await expect(page.getByRole('region', { name: 'Draft' })).toBeVisible();
  await page.goto('/admin/requests');
  await expect(
    page
      .getByRole('navigation', { name: 'Request groups' })
      .getByRole('link', { name: /^New/ }),
  ).toHaveAttribute('aria-current', 'page');
});

test('the dashboard menu folds away to a strip and comes back; the current page stands out', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/quotations');
  const menu = await dashboardMenu(page);
  const current = menu.getByRole('link', { name: 'Quotations', exact: true });
  await expect(current).toHaveAttribute('aria-current', 'page');

  if (testInfo.project.name === 'phone') {
    // On a phone the menu opens over the page and closes once a page is chosen.
    await menu.getByRole('link', { name: 'Leads', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/leads/);
    await expect(menu).toBeHidden();
    return;
  }
  await page.getByRole('button', { name: 'Hide the menu' }).click();
  await expect(menu).toBeHidden();
  // Remembered on the next page.
  await page.goto('/admin/orders');
  await expect(
    page.getByRole('button', { name: 'Show the menu' }),
  ).toBeVisible();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Show the menu' }).click();
  await expect(
    menu.getByRole('link', { name: 'Orders', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});
