import { expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The browser tests' API writes emails here instead of sending them (playwright.config.ts). */
const OUTBOX = fileURLToPath(
  new URL('../../api/.outbox-browser/', import.meta.url),
);

/** The plain-text part of the newest email to this address, once it has been written. */
export async function lastEmailTo(to: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const files = await readdir(OUTBOX).catch(() => [] as string[]);
    const mails = await Promise.all(
      files.sort().map((f) => readFile(join(OUTBOX, f), 'utf8')),
    );
    const mail = mails.filter((m) => m.includes(`\r\nTo: ${to}\r\n`)).at(-1);
    const body =
      mail &&
      /text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(
        mail,
      )?.[1];
    if (body) {
      return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    }
    // Emails are written just after the request returns.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email to ${to}`);
}

/**
 * After "Create account": reads the address from the code page, takes the code from the
 * email we just sent there, and enters it (the real sign-up flow, end to end).
 */
export async function finishSignUp(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  const email = (await page.locator('main strong').first().textContent())!;
  const code = /Your code is (\d{6})\./.exec(await lastEmailTo(email))?.[1];
  if (!code) throw new Error(`No sign-up code in the email to ${email}`);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(page).not.toHaveURL(/\/verify-email/);
}
