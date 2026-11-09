import type { Browser, Page } from '@playwright/test';
import { dashboardMenu, expect, test } from './fixtures';
import { signInAsAdmin, signInAsTeamMember } from './admin-session';

const menu = (page: Page) =>
  page.getByRole('navigation', { name: 'Dashboard' });

/** A second person in their own browser, as a separate visitor. */
async function secondBrowser(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      'cf-connecting-ip': `198.18.${Math.floor(Math.random() * 254) + 1}.77`,
    },
  });
  return { context, page: await context.newPage() };
}

test('a designer sees only their pages; other addresses are refused even when typed', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsTeamMember(context, baseURL!, 'DESIGNER');
  await page.goto('/admin');
  await dashboardMenu(page);
  for (const shown of [
    'Overview',
    'Custom requests',
    'Products',
    'Home page bed',
    'Materials',
  ]) {
    await expect(
      menu(page).getByRole('link', {
        name: shown,
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
  }
  for (const hidden of [
    'Orders',
    'Invoices',
    'Leads',
    'Team',
    'Roles & permissions',
    'Pricing',
    'Audit log',
  ]) {
    await expect(
      menu(page).getByRole('link', {
        name: hidden,
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
  }

  for (const address of [
    '/admin/orders',
    '/admin/accounting/books',
    '/admin/team',
    '/admin/permissions',
    '/admin/pricing',
  ]) {
    const response = await page.goto(address);
    expect(response?.status(), address).toBe(403);
    await expect(
      page.getByRole('heading', { name: 'Not allowed' }),
    ).toBeVisible();
  }

  // Materials: they may look (products need them), not change what they cost.
  await page.goto('/admin/materials');
  await expect(page.getByRole('link', { name: 'New material' })).toBeHidden();
  // Each material's form opens from the list, and stays locked.
  await page
    .getByRole('table')
    .locator('tbody')
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/materials\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText('You can see this page but not change it'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('an admin gives one staff member the books and takes away orders; it applies on their next click', async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  await signInAsAdmin(context, baseURL!);
  const staff = await secondBrowser(browser, baseURL!);
  const member = await signInAsTeamMember(staff.context, baseURL!, 'STAFF');
  try {
    // Before: orders yes, the books no (not even the button to them).
    await staff.page.goto('/admin/accounting');
    await dashboardMenu(staff.page);
    await expect(
      menu(staff.page).getByRole('link', {
        name: 'Orders',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    await expect(
      menu(staff.page).getByRole('link', {
        name: 'Books',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    expect((await staff.page.goto('/admin/accounting/books'))?.status()).toBe(
      403,
    );

    // The admin finds them on the Team page and changes two permissions.
    await page.goto(`/admin/team?q=${encodeURIComponent(member.email)}`);
    await page
      .getByRole('link', {
        name: 'Test staff',
        exact: true,
        includeHidden: true,
      })
      .first()
      .waitFor();
    await page.goto(`/admin/team/${member.id}`);
    await expect(
      page.getByRole('heading', { name: `Access: Test staff` }),
    ).toBeVisible();
    await page
      .getByLabel('See the books and financial reports')
      .selectOption('grant');
    await page.getByLabel('See orders', { exact: true }).selectOption('deny');
    // The preview applies the same rule as the API: denying orders also stops production.
    // The row whose own label is this (another row's "Also: …" may mention it).
    const row = (label: string) =>
      page
        .getByRole('row')
        .filter({ has: page.getByText(label, { exact: true }) });
    await expect(row('See orders').getByRole('cell').last()).toHaveText(
      'Cannot',
    );
    await expect(
      row('Plan and run print jobs (production)').getByRole('cell').last(),
    ).toHaveText('Cannot');
    await expect(
      row('See the books and financial reports').getByRole('cell').last(),
    ).toHaveText('Can');
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // Their very next page, same sign-in: the books open, orders and production are gone.
    await staff.page.goto('/admin/accounting');
    await dashboardMenu(staff.page);
    await expect(
      menu(staff.page).getByRole('link', {
        name: 'Books',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    await expect(
      menu(staff.page).getByRole('link', {
        name: 'Orders',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await expect(
      menu(staff.page).getByRole('link', {
        name: 'Production',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    expect((await staff.page.goto('/admin/accounting/books'))?.status()).toBe(
      200,
    );
    expect((await staff.page.goto('/admin/orders'))?.status()).toBe(403);
    await expect(
      staff.page.getByText('You do not have access to this page'),
    ).toBeVisible();
  } finally {
    await staff.context.close();
  }
});

test('admins edit what each role may do; team members never reach that page', async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/permissions');
  const staffForm = page.getByRole('form', { name: 'Staff permissions' });
  await expect(staffForm.locator('input[value="orders.view"]')).toBeChecked();
  await expect(
    staffForm.locator('input[value="books.view"]'),
  ).not.toBeChecked();
  await expect(staffForm.getByText('Also: see orders').first()).toBeVisible();
  // Saved as it is (other tests run alongside and rely on the defaults).
  await staffForm
    .getByRole('button', { name: 'Save staff permissions' })
    .click();
  await expect(staffForm.getByText('Saved', { exact: true })).toBeVisible();

  const staff = await secondBrowser(browser, baseURL!);
  try {
    await signInAsTeamMember(staff.context, baseURL!, 'STAFF');
    expect((await staff.page.goto('/admin/permissions'))?.status()).toBe(403);
    expect((await staff.page.goto('/admin/team'))?.status()).toBe(403);
  } finally {
    await staff.context.close();
  }
});
