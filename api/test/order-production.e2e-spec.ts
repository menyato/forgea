import type {
  OrderProduction,
  Page,
  PrintJobListItem,
  QuotationDetail,
  StockOverview,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { createStudio, moveOrder, type Studio } from './studio-helpers.js';

/**
 * An in-house order of pieces no product estimates (free-text lines at $0): its summary shows
 * what its finished print runs really took, by reel, with their recorded cost, and what stock
 * gave them; a line not printed yet leaves the cost unknown rather than understated.
 */
describe('Order summary measured by its print runs (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let studio: Studio;
  let printerId: string;

  beforeAll(async () => {
    app = await createApp();
    admin = await signedInAs(app, Role.ADMIN);
    studio = await createStudio(app);
    printerId = (
      await as(admin.cookie)
        .post('/printers', {
          name: `In-house ${randomUUID().slice(0, 8)}`,
          watts: 200,
          active: true,
        })
        .expect(201)
    ).body.id;
    await as(admin.cookie)
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour: 'Test Black',
        spools: 1,
        spoolGrams: 1000,
        pricePerSpool: '20.00',
        updateCost: false,
      })
      .expect(204);
  });
  afterAll(async () => {
    await app.close();
  });

  it('measures in-house pieces by their print runs, with their cost', async () => {
    const quotation = (
      await as(admin.cookie)
        .post('/quotations', {
          customerEmail: `inhouse-${randomUUID().slice(0, 8)}@example.com`,
          validUntil: '2099-12-31',
          customerName: 'Studio (in-house)',
          phone: '70 904 044',
          paymentMethod: 'TRANSFER',
          delivery: false,
          lines: [
            { description: 'Benchy, in-house', quantity: 1, unitPrice: '0' },
            { description: 'Fit test, in-house', quantity: 1, unitPrice: '0' },
          ],
        })
        .expect(201)
    ).body as QuotationDetail;
    await as(admin.cookie)
      .post(`/quotations/${quotation.id}/confirm`)
      .expect(200);
    const { orderId } = (
      await as(admin.cookie).get(`/quotations/${quotation.id}`).expect(200)
    ).body as QuotationDetail & { orderId: string };
    await moveOrder(app, admin.cookie, orderId, ['CONFIRMED', 'IN_PRODUCTION']);

    const summary = async () =>
      (await as(admin.cookie).get(`/orders/${orderId}/production`).expect(200))
        .body as OrderProduction;
    // Nothing printed yet: no estimate, and the cost is unknown.
    const before = await summary();
    expect(before.lines.map((l) => [l.grams, l.measured])).toEqual([
      [null, false],
      [null, false],
    ]);
    expect(before.money).toBeNull();

    const reel = (
      (await as(admin.cookie).get('/stock').expect(200)).body as StockOverview
    ).items.find(
      (i) => i.material.id === studio.material.id && i.colour === 'Test Black',
    )!;
    const jobs = (
      (await as(admin.cookie).get(`/print-jobs?orderId=${orderId}`).expect(200))
        .body as Page<PrintJobListItem>
    ).items;
    expect(jobs).toHaveLength(2);
    for (const [job, grams, hours] of [
      [jobs[0]!, '11.6', '0.5'],
      [jobs[1]!, '60', '4.2'],
    ] as const) {
      await as(admin.cookie)
        .patch(`/print-jobs/${job.id}`, {
          printerId,
          stockItemId: reel.id,
          grams,
          hours,
        })
        .expect(200);
      await as(admin.cookie)
        .patch(`/print-jobs/${job.id}`, { status: 'PRINTING' })
        .expect(200);
      await as(admin.cookie)
        .patch(`/print-jobs/${job.id}`, {
          status: 'DONE',
          actualGrams: grams,
          actualHours: hours,
        })
        .expect(200);
    }

    const after = await summary();
    expect(after.lines.every((l) => l.measured)).toBe(true);
    expect(after.grams).toBe('71.6');
    expect(after.printHours).toBe('4.70');
    expect(after.lines.flatMap((l) => l.colours)).toEqual(
      expect.arrayContaining([
        { colour: 'Test Black', grams: '11.6' },
        { colour: 'Test Black', grams: '60.0' },
      ]),
    );
    // Stock gave the runs' grams (each rounded up to a whole gram).
    expect(after.taken).toEqual([
      { material: studio.material.code, colour: 'Test Black', grams: 72 },
    ]);
    // Free pieces: their cost is the runs' recorded cost, and they lose that much.
    expect(after.money).not.toBeNull();
    expect(Number(after.money!.cost)).toBeGreaterThan(1);
    expect(after.money!.revenue).toBe('0.00');
    expect(Number(after.money!.profit)).toBe(-Number(after.money!.cost));
  });
});
