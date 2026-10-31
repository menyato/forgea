import { randomUUID } from 'node:crypto';
import type {
  BusinessInsights,
  InsightsTotals,
  StockOverview,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs, signedInCustomer } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import {
  createStudio,
  moveOrder,
  placeOrder,
  type Studio,
  TO_DELIVERED,
  useRoundPricing,
} from './studio-helpers.js';

const DAY = 86_400_000;
const day = (offset: number) =>
  new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/** Money as cents, so a difference of two figures is exact. */
const cents = (v: string) => Math.round(Number(v) * 100);
const delta = (after: string, before: string) =>
  ((cents(after) - cents(before)) / 100).toFixed(2);

/**
 * The business page (GET /insights) against a known day of trading. The test database is
 * shared, so every figure for "today" is checked as the difference this test makes to it; the
 * test's own product, category, colour group and material are checked as they are.
 */
describe('Business insights (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
  });

  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let salesTaxBefore: string | null;
  let studio: Studio;
  /** Today's figures before and after the test's trading. */
  let before: BusinessInsights;
  let after: BusinessInsights;
  let stock: StockOverview;
  let lostReason = '';

  const insights = async (from: string, to: string) =>
    (await as(admin.cookie).get(`/insights?from=${from}&to=${to}`).expect(200))
      .body as BusinessInsights;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    const staff = await signedInAs(app, Role.STAFF);
    restorePricing = await useRoundPricing(app, admin.cookie);
    // Prices include VAT 11% for this test (put back afterwards).
    const settings = await prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    salesTaxBefore = settings.salesTaxId;
    const vat = await prisma.tax.findFirstOrThrow({
      where: { name: 'VAT 11%' },
    });
    await prisma.accountingSettings.update({
      where: { id: 1 },
      data: { salesTaxId: vat.id },
    });
    studio = await createStudio(app);

    before = await insights(day(0), day(0));

    // Filament in: a spool of each colour.
    for (const colour of ['Red', 'Copper silk']) {
      await as(staff.cookie)
        .post('/stock/movements', {
          materialId: studio.material.id,
          colour,
          kind: 'RECEIVED',
          grams: 1000,
          note: 'Two spools from the supplier',
        })
        .expect(204);
    }

    const a = await signedInCustomer(app);
    const b = await signedInCustomer(app);
    const c = await signedInCustomer(app);
    const d = await signedInCustomer(app);

    // O1: 2 standard red, picked up, cash on delivery → paid when delivered.
    const o1 = await placeOrder(
      app,
      a.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 2 },
      { paymentMethod: 'COD', delivery: false },
    );
    // O2: 1 wide copper silk (+$2), delivered, rush, by transfer; $20 paid later.
    const o2 = await placeOrder(
      app,
      b.cookie,
      studio,
      { size: 'wide', colour: 'silk', quantity: 1 },
      { paymentMethod: 'TRANSFER', delivery: true, rush: true },
    );
    // O3: 1 standard red, picked up, by transfer; its invoice is credited.
    const o3 = await placeOrder(
      app,
      a.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'TRANSFER', delivery: false },
    );
    // O4: cancelled before production: it never takes filament.
    const o4 = await placeOrder(
      app,
      c.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    // D ordered years ago (cancelled), and orders again today: a returning customer whose
    // open order will need 100 g of red.
    const old = await placeOrder(
      app,
      d.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'TRANSFER', delivery: false },
    );
    await moveOrder(app, staff.cookie, old.id, ['CANCELLED']);
    await prisma.order.update({
      where: { id: old.id },
      data: { createdAt: new Date('2020-01-15T10:00:00Z') },
    });
    await placeOrder(
      app,
      d.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'TRANSFER', delivery: false },
    );

    await moveOrder(app, staff.cookie, o1.id, TO_DELIVERED(false));
    await moveOrder(app, staff.cookie, o2.id, TO_DELIVERED(true));
    await moveOrder(app, staff.cookie, o3.id, TO_DELIVERED(false));
    await moveOrder(app, staff.cookie, o4.id, ['CANCELLED']);

    const invoiceOf = async (orderId: string) =>
      (
        (
          await as(staff.cookie)
            .get(`/accounting/orders/${orderId}/invoices`)
            .expect(200)
        ).body as { id: string; invoiceKind: string; residual: string }[]
      ).find((i) => i.invoiceKind === 'FINAL')!;
    await as(staff.cookie)
      .post('/accounting/payments', {
        invoiceId: (await invoiceOf(o2.id)).id,
        amount: '20.00',
        method: 'BANK',
        date: day(0),
      })
      .expect(201);
    await as(admin.cookie)
      .post(`/accounting/invoices/${(await invoiceOf(o3.id)).id}/credit-note`)
      .expect(201);

    // An expense in the books: $10 of rent paid in cash.
    const accounts = (
      await as(admin.cookie).get('/accounting/accounts').expect(200)
    ).body as { id: string; code: string }[];
    await as(admin.cookie)
      .post('/accounting/entries', {
        date: day(0),
        label: 'Insights test rent',
        lines: [
          {
            accountId: accounts.find((x) => x.code === '6000')!.id,
            debit: '10.00',
          },
          {
            accountId: accounts.find((x) => x.code === '1000')!.id,
            credit: '10.00',
          },
        ],
      })
      .expect(201);

    // The sales funnel: two custom requests (each opens a lead), one quoted; a quotation
    // sent; two leads of the team's, one won and one lost.
    for (const title of ['Lamp shade', 'Chess set']) {
      await as(a.cookie)
        .post('/custom-requests', {
          title,
          description: `A ${title} in copper.`,
        })
        .expect(201);
    }
    const request1 = await prisma.customRequest.findFirstOrThrow({
      where: { userId: a.user.id, title: 'Lamp shade' },
    });
    await as(staff.cookie)
      .post(`/custom-requests/${request1.id}/quote`, { price: '80.00' })
      .expect(200);
    const quotation = await as(staff.cookie)
      .post('/quotations', {
        customerEmail: b.user.email,
        validUntil: '2099-12-31',
        customerName: 'Karim Haddad',
        phone: '70 111 222',
        paymentMethod: 'TRANSFER',
        delivery: false,
        lines: [{ description: 'Brackets', quantity: 10, unitPrice: '4.00' }],
      })
      .expect(201);
    await as(staff.cookie)
      .post(`/quotations/${quotation.body.id}/send`)
      .expect(200);
    const stages = (await as(staff.cookie).get('/lead-stages').expect(200))
      .body as {
      id: string;
      isWon: boolean;
    }[];
    const reasons = (await as(staff.cookie).get('/lost-reasons').expect(200))
      .body as {
      id: string;
      name: string;
    }[];
    const lead = (name: string) =>
      as(staff.cookie)
        .post('/leads/manual', {
          name,
          email: `lead-${randomUUID().slice(0, 6)}@example.com`,
          message: 'Branded key holders.',
        })
        .expect(201)
        .then((r) => r.body.id as string);
    const won = await lead('Hotel Phoenicia');
    const lost = await lead('Cafe Younes');
    await as(staff.cookie)
      .post(`/leads/${won}/stage`, { stageId: stages.find((s) => s.isWon)!.id })
      .expect(200);
    await as(staff.cookie)
      .post(`/leads/${lost}/lose`, { lostReasonId: reasons[0]!.id })
      .expect(200);
    lostReason = reasons[0]!.name;

    after = await insights(day(0), day(0));
    stock = (await as(admin.cookie).get('/stock').expect(200))
      .body as StockOverview;
  });

  afterAll(async () => {
    await restorePricing();
    await prisma.accountingSettings.update({
      where: { id: 1 },
      data: { salesTaxId: salesTaxBefore },
    });
    await app.close();
  });

  const change = (key: keyof InsightsTotals) =>
    delta(String(after.current[key]), String(before.current[key]));

  it('adds up revenue, tax, estimated cost, profit and cash exactly', () => {
    // Revenue without VAT, line by line: 52.00 → 46.85; 47.20 → 42.52; rush 9.44 → 8.50;
    // delivery 4.00 → 3.60; O3's 26.00 invoiced and credited the same day → 0.
    expect(change('revenue')).toBe('101.47');
    expect(change('tax')).toBe('11.17');
    expect(change('revenueWithTax')).toBe('112.64');
    // 2 × $13.00 (standard) + 1 × $22.60 (wide; the silk add-on is no cost).
    expect(change('productionCost')).toBe('48.60');
    expect(change('grossProfit')).toBe('52.87');
    expect(change('uncostedRevenue')).toBe('0.00');
    expect(change('expenses')).toBe('10.00');
    expect(change('netProfit')).toBe('91.47');
    // Cash on delivery 52.00 + 20.00 by transfer; O2 still owes 60.64 − 20.
    expect(change('cashCollected')).toBe('72.00');
    expect(change('owed')).toBe('40.64');
    expect(after.current.orders - before.current.orders).toBe(4);
    // 52.00 + 60.64 + 26.00 + 26.00 (cancelled O4 left out).
    expect(change('orderValue')).toBe('164.64');
    expect(after.current.grossMarginPercent).toBe(
      (
        (Number(after.current.grossProfit) / Number(after.current.revenue)) *
        100
      ).toFixed(1),
    );
  });

  it('shows the product, its category and the colours chosen', () => {
    expect(after.products).toContainEqual({
      productId: studio.product.id,
      name: studio.product.name,
      category: studio.category.name,
      units: 3,
      // 46.85 + 42.52 (the credited O3 nets out of its line)
      revenue: '89.37',
      productionCost: '48.60',
      marginPercent: '45.6',
    });
    expect(after.categories).toContainEqual({
      name: studio.category.name,
      units: 3,
      revenue: '89.37',
    });
    expect(after.options).toContainEqual({
      group: studio.colourGroup,
      values: [
        { value: 'Red', units: 4 },
        { value: 'Copper silk', units: 1 },
      ],
    });
  });

  it('counts orders, customers and the funnel', () => {
    const was = before.orders;
    const now = after.orders;
    const status = (s: string) =>
      (now.byStatus[s as 'DELIVERED'] ?? 0) -
      (was.byStatus[s as 'DELIVERED'] ?? 0);
    expect(now.placed - was.placed).toBe(5);
    expect(now.cancelled - was.cancelled).toBe(1);
    expect(status('DELIVERED')).toBe(3);
    expect(status('CANCELLED')).toBe(1);
    expect(status('PENDING')).toBe(1);
    expect(now.newCustomers - was.newCustomers).toBe(2);
    expect(now.returningCustomers - was.returningCustomers).toBe(1);
    expect(now.delivery - was.delivery).toBe(1);
    expect(now.pickup - was.pickup).toBe(3);
    expect(now.cashOnDelivery - was.cashOnDelivery).toBe(1);
    expect(now.transfer - was.transfer).toBe(3);
    expect(now.rush - was.rush).toBe(1);
    expect(after.requests.submitted - before.requests.submitted).toBe(2);
    expect(after.requests.quoted - before.requests.quoted).toBe(1);
    expect(after.requests.accepted - before.requests.accepted).toBe(0);
    expect(after.quotations.created - before.quotations.created).toBe(1);
    expect(after.quotations.sent - before.quotations.sent).toBe(1);
    expect(after.quotations.confirmed - before.quotations.confirmed).toBe(0);
    // Two from the team, two opened by the custom requests.
    expect(after.leads.created - before.leads.created).toBe(4);
    expect(after.leads.won - before.leads.won).toBe(1);
    expect(after.leads.lost - before.leads.lost).toBe(1);
    const reason = (i: BusinessInsights) =>
      i.leads.lostReasons.find((r) => r.name === lostReason)?.count ?? 0;
    expect(reason(after) - reason(before)).toBe(1);
  });

  it('takes filament out of stock by size and colour when orders go into production', () => {
    const line = (colour: string) =>
      stock.items.find(
        (i) => i.material.id === studio.material.id && i.colour === colour,
      )!;
    // Red: O1 2 × 100 g + O3 100 g; O4 was cancelled before production. Copper silk: O2's
    // wide size, 200 g. D's open order will take 100 g of red.
    expect(line('Red')).toMatchObject({
      stockGrams: 700,
      committedGrams: 100,
      availableGrams: 600,
      used30Grams: 300,
    });
    expect(line('Copper silk')).toMatchObject({
      stockGrams: 800,
      committedGrams: 0,
      used30Grams: 200,
    });
    expect(
      stock.usage.rows.filter((r) => r.productId === studio.product.id),
    ).toEqual([
      {
        productId: studio.product.id,
        product: studio.product.name,
        materialCode: studio.material.code,
        colour: 'Red',
        grams: 300,
      },
      {
        productId: studio.product.id,
        product: studio.product.name,
        materialCode: studio.material.code,
        colour: 'Copper silk',
        grams: 200,
      },
    ]);
    // The business page shows the same use.
    expect(
      after.materials.filter((m) => m.code === studio.material.code),
    ).toEqual([
      expect.objectContaining({
        colour: 'Red',
        usedGrams: 300,
        stockGrams: 700,
      }),
      expect.objectContaining({
        colour: 'Copper silk',
        usedGrams: 200,
        stockGrams: 800,
      }),
    ]);
  });

  it('charts the day, and compares with the day before', async () => {
    expect(after.granularity).toBe('day');
    expect(after.series).toEqual([
      {
        start: day(0),
        revenue: after.current.revenue,
        productionCost: after.current.productionCost,
        grossProfit: after.current.grossProfit,
      },
    ]);
    // Tomorrow's page compares with today: the same figures.
    const tomorrow = await insights(day(1), day(1));
    expect(tomorrow.previous).toEqual({ from: day(0), to: day(0) });
    expect(tomorrow.before).toEqual(after.current);
    expect(after.previous).toEqual({ from: day(-1), to: day(-1) });
  });

  it('defaults to this month, and refuses periods that make no sense', async () => {
    const month = (await as(admin.cookie).get('/insights').expect(200))
      .body as BusinessInsights;
    expect(month.range).toEqual({
      from: `${day(0).slice(0, 7)}-01`,
      to: day(0),
    });
    const refused = async (query: string) =>
      (await as(admin.cookie).get(`/insights?${query}`).expect(400)).body;
    await refused('from=2026-10-01');
    await refused('from=2026-10-31&to=2026-10-01');
    await refused('from=2026-02-30&to=2026-03-01');
    await refused('from=2020-01-01&to=2026-01-01');
    await refused('from=yesterday&to=today');
  });

  it('is for those who see the books', async () => {
    const customer = await signedInCustomer(app);
    const staff = await signedInAs(app, Role.STAFF);
    const designer = await signedInAs(app, Role.DESIGNER);
    for (const who of [customer, staff, designer])
      await as(who.cookie).get('/insights').expect(403);
    await prisma.user.update({
      where: { id: staff.user.id },
      data: { grantedPermissions: ['books.view'] },
    });
    await as(staff.cookie).get('/insights').expect(200);
    await http().get('/insights').expect(401);
  });
});
