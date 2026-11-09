import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { finishSignUp } from './mail';

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
  await finishSignUp(page);
  await expect(page).not.toHaveURL(/\/register/);

  await page.goto('/account');
  await expect(page.getByText('· confirmed')).toBeVisible();
  await page.getByLabel('Phone').fill('70 222 333');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
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

/** The header's profile link (on a phone it sits in the closed menu, so not by its role). */
const signedIn = (page: Page) =>
  page.locator('a[href="/account"]', { hasText: 'Rami Return' }).first();

test('arriving from another site (back from Google, an email link) lands signed in, on the home page', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Name (optional)').fill('Rami Return');
  await page.getByLabel('Email').fill(uniqueEmail('return'));
  await page.getByLabel('Password').fill('correct-horse-battery-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await finishSignUp(page);
  // Signed up: the home page, with who is signed in in the header.
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(signedIn(page)).toBeAttached();

  // A link on another site (127.0.0.1 is another site than localhost) back to the shop: the
  // page is signed in at once, no refresh (SameSite=Strict cookies would stay behind).
  await page.goto('http://127.0.0.1:5198/shop');
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'http://localhost:5198/shop';
    a.textContent = 'back to Forgea';
    a.id = 'from-elsewhere';
    document.body.prepend(a);
  });
  await page.locator('#from-elsewhere').click();
  await expect(page).toHaveURL('http://localhost:5198/shop');
  await expect(signedIn(page)).toBeAttached();

  // Signed in, the sign-in and sign-up pages go straight on instead of showing their forms.
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/:\d+\/$/);
  await page.goto('/register?next=%2Forders');
  await expect(page).toHaveURL(/\/orders$/);
});
