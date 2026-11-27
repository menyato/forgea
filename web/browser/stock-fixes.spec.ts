import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test.skip(({ isMobile }) => isMobile, 'One run is enough');

test('a print recorded on the wrong filament is moved to the right one, and a sweep weighs the shelf', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const note = `Wrong reel ${Date.now().toString(36)}`;

  // Printed for the studio, on whatever filament the product said.
  await page.goto('/admin/stock/print');
  await page.getByLabel('How many').fill('1');
  await page.getByLabel('Why (optional)').fill(note);
  await page.getByLabel('Keep them on the shelf to sell').uncheck();
  await page.getByRole('button', { name: 'Take it off the shelf' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Its row opens the movement; what it was for opens the product.
  await page.goto(`/admin/stock/movements?q=${encodeURIComponent(note)}`);
  const row = page.getByRole('row').filter({ hasText: note });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name: /^1 × / })).toHaveAttribute(
    'href',
    /\/admin\/products\/[0-9a-f-]{36}$/,
  );
  await expect(row.getByRole('link', { name: 'Where it is' })).toBeVisible();
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/admin\/stock\/movements\/[0-9a-f-]{36}$/);

  // It really came off another filament: moved there, and the page says where it was.
  const it = page.getByLabel('It really was');
  const choice = (await it.locator('option').nth(1).textContent())!;
  await it.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Move to that filament' }).click();
  await page.getByRole('button', { name: 'Yes, move them' }).click();
  await expect(page.getByText(/^First recorded on /)).toBeVisible();
  await expect(
    page.getByRole('link', { name: choice.replace(/ \(.*$/, '') }).first(),
  ).toBeVisible();

  // The sweep: one filament weighed, its difference recorded.
  await page.goto('/admin/stock/sweep');
  await page.getByLabel('An empty spool weighs (g)').fill('200');
  const first = page
    .getByRole('table', { name: 'Filaments to weigh' })
    .getByRole('row')
    .nth(1);
  await first.getByLabel(/sealed spools/).fill('0');
  await first.getByLabel(/open spool on the scale/).fill('700');
  await expect(first.getByText('500 g')).toBeVisible();
  await page.getByRole('button', { name: 'Save the sweep' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'See the corrections' }),
  ).toBeVisible();
});
