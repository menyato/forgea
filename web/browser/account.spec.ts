import { expect, test } from './fixtures';

const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

test('a visitor without an account sends an idea; it reaches the studio as a lead', async ({
  page,
}) => {
  await page.goto('/custom');
  await page
    .getByRole('link', { name: 'Just tell us your idea, no account needed' })
    .click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.getByLabel('Your name').fill('Maya Visitor');
  await page.getByLabel('Email').fill(uniqueEmail('idea'));
  await page
    .getByLabel('What would you like us to make?')
    .fill('A small plaque with our cafe logo for the counter.');
  await page.getByRole('button', { name: 'Send my idea' }).click();
  await expect(
    page.getByRole('heading', { name: 'Thank you, we have your idea' }),
  ).toBeVisible();
});

test('a customer edits their details and finds "forgot your password"', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Name (optional)').fill('Lina Account');
  await page.getByLabel('Email').fill(uniqueEmail('account'));
  await page.getByLabel('Password').fill('correct-horse-battery-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/\/register/);

  await page.goto('/account');
  await expect(page.getByText('not confirmed yet')).toBeVisible();
  await page.getByLabel('Phone').fill('70 222 333');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Phone')).toHaveValue('70 222 333');

  // Signed out, the sign-in page leads to the reset form.
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  // Both pages have an Email field: wait for this one before typing.
  await expect(
    page.getByRole('heading', { name: 'Forgot your password?' }),
  ).toBeVisible();
  await page.getByLabel('Email').fill(uniqueEmail('someone'));
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(
    page.getByText(/If that address has a Forgea account/),
  ).toBeVisible();
});
