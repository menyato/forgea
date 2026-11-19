import { crc32, deflateSync } from 'node:zlib';
import { signInAsAdmin } from './admin-session';
import { expect, newVisitor, test } from './fixtures';

/** A PNG picture (RGBA): dark where `ink` holds, white elsewhere, as a logo file would be. */
function png(
  w: number,
  h: number,
  ink: (x: number, y: number) => boolean,
): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const v = ink(x, y) ? 20 : 250;
      raw.set([v, v, v, 255], o);
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A ring: what a simple round logo looks like. */
const RING = png(120, 120, (x, y) => {
  const d = Math.hypot(x - 60, y - 60);
  return d < 45 && d > 25;
});

test('a customer drops their own logo picture on a keychain: traced, shown in 3D, priced alone, ordered', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  // The studio lets name keychain customers bring their own logo.
  const studio = await newVisitor(browser);
  await signInAsAdmin(studio, baseURL!);
  const admin = await studio.newPage();
  await admin.goto('/admin/products?q=Name%20keychain');
  await admin.getByRole('link', { name: 'Name keychain' }).first().click();
  const own = admin.getByLabel('Customers may bring their own logo');
  if (!(await own.isChecked())) {
    await own.check();
    await admin.getByRole('button', { name: 'Save product' }).click();
    await expect(admin.getByText('Saved', { exact: true })).toBeVisible();
  }
  await studio.close();

  // Design yours: the keychain is where customers start from their logo.
  await page.goto('/design');
  const fromLogo = page.getByRole('region', { name: 'Start from your logo' });
  await expect(fromLogo.getByText('Name keychain')).toBeVisible();
  await page.goto('/products/name-keychain');
  await page.getByLabel(/Drop a PNG, JPEG or SVG here/).setInputFiles({
    name: 'my-logo.png',
    mimeType: 'image/png',
    buffer: RING,
  });
  await expect(page.getByText(/my-logo\.png: on your piece/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('radio', { name: 'Your logo' })).toBeChecked();
  // No name: the logo alone is the piece, and it is priced.
  await expect(
    page
      .locator('[aria-live="polite"]:not([aria-busy="true"]) > p')
      .first()
      .getByText(/^\$\d+\.\d{2}$/),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('In your cart.')).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/cart');
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Name keychain' })
      .getByText(/Your logo/)
      .first(),
  ).toBeVisible();
});
