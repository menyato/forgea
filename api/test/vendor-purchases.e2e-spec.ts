import type { StockOverview } from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { createStudio, type Studio } from './studio-helpers.js';

/**
 * A vendor's bill as it reads: several reels at their prices, a discount on the whole bill.
 * Each reel goes on the shelf at what it really cost (the discount shared by price), keeps its
 * own price per gram, and the bill is booked once; sent twice, it is recorded once.
 */
describe('Vendor purchases of filament (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let studio: Studio;
  const post = (url: string, body: object, cookie = admin.cookie) =>
    request(app.getHttpServer())
      .post(url)
      .set(CSRF)
      .set('Cookie', cookie)
      .send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('shelves each reel at its share of the discount and books the bill once', async () => {
    const tag = randomUUID().slice(0, 6);
    const bill = {
      requestKey: randomUUID(),
      vendor: 'Elegoo store',
      reference: `INV-${tag}`,
      discount: '9.00',
      paidFrom: 'CASH',
      lines: [
        ['Red', '18.00'],
        ['Green', '20.00'],
        ['Blue', '18.00'],
      ].map(([colour, price]) => ({
        materialId: studio.material.id,
        colour: `${colour} ${tag}`,
        spools: 1,
        spoolGrams: 1000,
        pricePerSpool: price,
      })),
    };
    const done = await post('/stock/purchases', bill).expect(200);
    expect(done.body).toEqual({ total: '47.00', reels: 3 });
    // Sent twice (a double click): recorded once.
    await post('/stock/purchases', bill).expect(200);

    const items = (
      (
        await request(app.getHttpServer())
          .get('/stock')
          .set('Cookie', admin.cookie)
          .expect(200)
      ).body as StockOverview
    ).items.filter((i) => i.colour.endsWith(tag));
    expect(
      items.map((i) => [i.colour.split(' ')[0], i.stockGrams, i.costPerGram]),
    ).toEqual([
      ['Blue', 1000, '0.0151'],
      ['Green', 1000, '0.0168'],
      ['Red', 1000, '0.0151'],
    ]);
    const entries = await prisma.journalEntry.findMany({
      where: { label: `Filament: Elegoo store INV-${tag}` },
      include: { lines: true },
    });
    expect(entries).toHaveLength(1);
    expect(
      entries[0]!.lines.reduce((n, l) => n + Number(l.debit), 0).toFixed(2),
    ).toBe('47.00');
  });

  it('refuses a discount over the bill and needs stock.manage', async () => {
    const line = {
      materialId: studio.material.id,
      colour: 'Over',
      spools: 1,
      spoolGrams: 1000,
      pricePerSpool: '10.00',
    };
    await post('/stock/purchases', {
      vendor: 'Shop',
      discount: '11',
      lines: [line],
    }).expect(400);
    await post('/stock/purchases', { vendor: 'Shop', lines: [] }).expect(400);
    const designer = await signedInAs(app, Role.DESIGNER);
    await post(
      '/stock/purchases',
      { vendor: 'Shop', lines: [line] },
      designer.cookie,
    ).expect(403);
  });
});
