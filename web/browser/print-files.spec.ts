import { cube } from '../../api/prisma/example-models';
import { bambuThreeMf } from '../../api/test/three-mf-file';
import { signInAsAdmin } from './admin-session';
import { expect, test } from './fixtures';

test('a product shown assembled and printed from sliced files: their totals price it, and the dashboard shows its model', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL!);
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const name = `Twist lamp ${tag}`;

  await page.goto('/admin/products/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Description').fill('A lamp printed in two plates.');

  // The look customers see: the assembled model.
  await page.getByLabel(/3D model \(STL, GLB or 3MF/).setInputFiles({
    name: 'lamp_assembly.stl',
    mimeType: 'model/stl',
    buffer: cube(30),
  });
  await page
    .getByRole('button', { name: 'Upload', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('img', { name: /3D view of/ }).locator('canvas'),
  ).toBeVisible({ timeout: 15_000 });

  // The sliced files it is printed from, one after the other.
  const files = page.getByRole('list', { name: 'Print files' });
  for (const [i, file] of [
    'lamp_1_base_sliced.gcode.3mf',
    'lamp_2_shade_sliced.gcode.3mf',
  ].entries()) {
    await page.getByLabel(/Sliced print file/).setInputFiles({
      name: file,
      mimeType: 'model/3mf',
      buffer: bambuThreeMf({ sliced: true }),
    });
    await page.getByRole('button', { name: 'Add print file' }).click();
    await expect(
      files.getByRole('listitem').filter({ hasText: 'g,' }),
    ).toHaveCount(i + 1);
  }
  // Named after their files, each with what the slicer says and how it was set up.
  await expect(page.getByLabel('Name of print file 1')).toHaveValue(
    'lamp 1 base',
  );
  await expect(page.getByLabel('Name of print file 2')).toHaveValue(
    'lamp 2 shade',
  );
  await expect(
    files.getByText(/Bambu Lab X2D · 0\.4 mm nozzle · 0\.12 mm layers/).first(),
  ).toBeVisible();
  await expect(page.getByText(/In all:/)).toContainText('25.00 g');
  await expect(page.getByText(/In all:/)).toContainText('3 h ');

  // One click makes the total the product's grams, time and colours.
  await page.getByRole('button', { name: 'Use the totals' }).click();
  await expect(page.getByLabel('Material (g)')).toHaveValue('25.0');
  await expect(page.getByLabel('Print time (h)')).toHaveValue('3.00');
  await expect(page.getByLabel('Grams of colour 1')).toHaveValue('20.50');
  await page
    .getByLabel(/Colour 1 \(file colour #aa2222\)/)
    .fill(`Shade ${tag}`);
  // The second colour is printed from a reel on the shelf: it takes that reel's name, and
  // its cost and stock follow that reel.
  const reel = page.getByLabel('Filament colour 2 is printed from');
  await reel.selectOption({ index: 1 });
  await expect(
    page.getByLabel(/Colour 2 \(file colour #b87333\)/),
  ).not.toHaveValue('');
  // The price is the slicer's: no purge waste added on top.
  await expect(
    page.getByText(/purge, tower and supports are in the sliced grams/),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Name of print file 2')).toHaveValue(
    'lamp 2 shade',
  );
  await expect(page.getByText(/In all:/)).toContainText('25.00 g');
  await expect(
    page.getByLabel('Filament colour 2 is printed from'),
  ).not.toHaveValue('');

  // The dashboard's list and kanban show the product as the shop does: its model.
  for (const view of ['list', 'kanban']) {
    await page.goto(
      `/admin/products?q=${encodeURIComponent(name)}&view=${view}`,
    );
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: 15_000,
    });
  }
});
