import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'One run is enough');

test('a print still printing waits on the board, is finished there, and is given to someone', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const note = `Board ${Date.now().toString(36)}`;

  // Printed for the studio, still on the printer: nothing comes off the shelf yet.
  await page.goto('/admin/stock/print');
  await page.getByLabel('How many').fill('1');
  await page.getByLabel('Why (optional)').fill(note);
  await page.getByLabel('Keep them on the shelf to sell').uncheck();
  await page.getByLabel('Still printing').check();
  await page.getByRole('button', { name: 'Take it off the shelf' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // On the board, as Printing.
  await page.goto(`/admin/pieces?view=list&q=${encodeURIComponent(note)}`);
  const row = page.getByRole('row').filter({ hasText: 'Printing' });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await expect(
    page.getByRole('heading', { name: 'Still printing' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'It is done' }).click();
  await expect(
    page.getByRole('heading', { name: 'Where it is' }).last(),
  ).toBeVisible();

  // On the kanban, moved without dragging: Move to under its card.
  await page.goto(`/admin/pieces?view=kanban&q=${encodeURIComponent(note)}`);
  const lab = page.getByRole('region', { name: 'In the lab' });
  await lab.getByRole('combobox', { name: 'Move to' }).selectOption('IN_SHOP');
  const shop = page.getByRole('region', { name: 'In the shop' });
  await expect(shop.getByText(note)).toBeVisible();
  await expect(lab.getByText(note)).toHaveCount(0);
  await shop.getByRole('link').filter({ hasText: note }).first().click();

  // Given to someone, by name: the history keeps each move.
  await page
    .getByRole('combobox', { name: 'Where it is' })
    .selectOption('GIVEN');
  await page.getByLabel('Given to').fill('Mira');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByText('Given · Mira')).toBeVisible();
  await expect(history.getByText('In the shop')).toBeVisible();
  await expect(history.getByText('In the lab')).toBeVisible();
  await expect(history.getByText('Printing')).toBeVisible();
});
