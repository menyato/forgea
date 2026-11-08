import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { finishSignUp } from './mail';

/** A new customer signs up (email + password, then the emailed code) and lands on `next`. */
export async function signUp(page: Page, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Name (optional)').fill('Rana Request');
  await page
    .getByLabel('Email')
    .fill(
      `request-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`,
    );
  await page.getByLabel('Password').fill('correct-horse-battery-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await finishSignUp(page);
  await expect(page).toHaveURL(new RegExp(next));
}
