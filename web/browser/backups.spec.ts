import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

/** The browser tests' API reads backups here (playwright.config.ts). */
const ROOT = fileURLToPath(
  new URL('../../api/.backups-browser/', import.meta.url),
);
const FILE = 'forgea-staging-2026-11-04-101500-manual.tar';

test.skip(({ isMobile }) => isMobile, 'The Backups page: one run is enough');

test.beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, 'backups'), { recursive: true });
  await mkdir(join(ROOT, 'requests', 'queue'), { recursive: true });
  await writeFile(join(ROOT, 'backups', FILE), Buffer.alloc(4096, 1));
});

const requests = async () =>
  Promise.all(
    (await readdir(join(ROOT, 'requests', 'queue'))).map(async (f) =>
      JSON.parse(await readFile(join(ROOT, 'requests', 'queue', f), 'utf8')),
    ),
  );

test('an admin sees the backups and the disk, downloads one, and asks for a backup, a restore and a delete', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/backups');
  await expect(
    page.getByRole('heading', { name: 'Backups', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('meter', { name: 'Server disk used' }),
  ).toBeVisible();
  await expect(page.getByText(/GB free of/)).toBeVisible();
  const row = page
    .getByRole('listitem')
    .filter({ hasText: 'Made with "Back up now"' });
  await expect(row).toContainText('4 KB');

  // Download: the encrypted file itself, under its own name.
  const download = page.waitForEvent('download');
  await row.getByRole('link', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe(FILE);

  // Restore asks for the environment's name first.
  await row.getByRole('button', { name: 'Restore…' }).click();
  await row.getByLabel(/Type staging to confirm/).fill('production');
  await row.getByRole('button', { name: 'Restore this backup' }).click();
  await expect(row.getByText(/Type staging to confirm/).last()).toBeVisible();
  await expect(
    row.getByText('Type staging to confirm: everything since'),
  ).toBeVisible();
  await row.getByLabel(/Type staging to confirm/).fill('staging');
  await row.getByRole('button', { name: 'Restore this backup' }).click();
  // The server picks it up; the page follows (here no server runs, so it stays waiting).
  await expect(
    page.getByText('The server is about to start what you asked for…'),
  ).toBeVisible();
  expect(await requests()).toEqual([
    expect.objectContaining({ action: 'restore', file: FILE }),
  ]);
});

test('how many to keep is saved; delete and back up now are asked for', async ({
  page,
  context,
  baseURL,
}) => {
  await rm(join(ROOT, 'requests', 'queue'), { recursive: true, force: true });
  await mkdir(join(ROOT, 'requests', 'queue'));
  await signInAsAdmin(context, baseURL!);
  await page.goto('/admin/backups');
  await page.getByLabel('Backups kept on the server').selectOption('7');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect(
    JSON.parse(await readFile(join(ROOT, 'requests', 'settings.json'), 'utf8')),
  ).toEqual({ keep: 7 });

  page.once('dialog', (d) => void d.accept());
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Made with "Back up now"' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(
    page.getByText('The server is about to start what you asked for…'),
  ).toBeVisible();
  expect(await requests()).toEqual([
    expect.objectContaining({ action: 'delete', file: FILE }),
  ]);
  // Busy: "Back up now" waits until the server has done what was asked.
  await expect(
    page.getByRole('button', { name: 'Back up now' }),
  ).toBeDisabled();
});
