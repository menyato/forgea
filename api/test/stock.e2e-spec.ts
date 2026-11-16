import type {
  Page,
  FilamentChoice,
  StockItemView,
  StockMovementCounts,
  StockMovementView,
  StockOverview,
  StockPrintable,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
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
  useRoundPricing,
} from './studio-helpers.js';

/**
 * Filament stock: movements in and out (append-only), orders taking their grams when they go
 * into production, failed prints, and the restock advice.
 */
describe('Filament stock (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let staff: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;

  const line = async (colour: string): Promise<StockItemView> => {
    const overview = (await as(staff.cookie).get('/stock').expect(200))
      .body as StockOverview;
    return overview.items.find(
      (i) => i.material.id === studio.material.id && i.colour === colour,
    )!;
  };
  /** The movements list (newest first), as the dashboard asks for it. */
  const movements = async (query = '') =>
    (await as(staff.cookie).get(`/stock/movements${query}`).expect(200))
      .body as Page<StockMovementView>;
  const receive = (colour: string, grams: number) =>
    as(staff.cookie)
      .post('/stock/movements', {
        materialId: studio.material.id,
        colour,
        kind: 'RECEIVED',
        grams,
      })
      .expect(204);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    staff = await signedInAs(app, Role.STAFF);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('records deliveries, other use and corrections; the material total follows', async () => {
    await receive('Red', 1000);
    await as(staff.cookie)
      .post('/stock/movements', {
        materialId: studio.material.id,
        colour: 'Red',
        kind: 'USED',
        grams: 30,
        note: 'Samples for the fair',
      })
      .expect(204);
    await as(staff.cookie)
      .post('/stock/movements', {
        materialId: studio.material.id,
        colour: 'Red',
        kind: 'CORRECTION',
        grams: -20,
        note: 'Weighed the spools',
      })
      .expect(204);
    expect(await line('Red')).toMatchObject({
      stockGrams: 950,
      used30Grams: 30,
    });
    const material = await prisma.material.findUniqueOrThrow({
      where: { id: studio.material.id },
    });
    expect(material.stockGrams).toBe(950);

    // A use is a positive number; an order movement can't be recorded by hand.
    for (const bad of [
      { kind: 'USED', grams: -5 },
      { kind: 'RECEIVED', grams: 0 },
      { kind: 'ORDER', grams: -5 },
      { kind: 'RECEIVED', grams: 2.5 },
    ]) {
      await as(staff.cookie)
        .post('/stock/movements', {
          materialId: studio.material.id,
          colour: 'Red',
          ...bad,
        })
        .expect(400);
    }
    // The log is append-only: the database refuses to change a movement.
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockItem: { materialId: studio.material.id } },
    });
    await expect(
      prisma.stockMovement.update({
        where: { id: movement.id },
        data: { grams: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.stockMovement.delete({ where: { id: movement.id } }),
    ).rejects.toThrow();
    await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: staff.user.id, action: 'stock.movement' },
    });
  });

  it('takes an order’s grams at production, gives back what was never printed, never twice', async () => {
    await receive('Copper silk', 1000);
    const customer = await signedInCustomer(app);
    const red = (await line('Red')).stockGrams;

    // Cancelled once confirmed, before production: nothing is taken.
    const early = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'wide', colour: 'red', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    expect((await line('Red')).committedGrams).toBe(200);
    await moveOrder(app, staff.cookie, early.id, ['CONFIRMED', 'CANCELLED']);
    expect(await line('Red')).toMatchObject({
      stockGrams: red,
      committedGrams: 0,
    });

    // 3 wide copper silk: 3 × 200 g when it goes into production.
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'wide', colour: 'silk', quantity: 3 },
      { paymentMethod: 'COD', delivery: false },
    );
    await moveOrder(app, staff.cookie, order.id, ['CONFIRMED']);
    expect(await line('Copper silk')).toMatchObject({
      stockGrams: 1000,
      committedGrams: 600,
      availableGrams: 400,
    });
    await moveOrder(app, staff.cookie, order.id, ['IN_PRODUCTION']);
    expect(await line('Copper silk')).toMatchObject({
      stockGrams: 400,
      committedGrams: 0,
      used30Grams: 600,
    });
    const taken = await movements(`?q=${order.orderNumber}`);
    expect(taken.items).toEqual([
      expect.objectContaining({
        kind: 'ORDER',
        grams: -600,
        colour: 'Copper silk',
        orderNumber: order.orderNumber,
        stockItemId: (await line('Copper silk')).id,
      }),
    ]);
    // Cancelled after production started, before anything printed: the filament comes back.
    await moveOrder(app, staff.cookie, order.id, ['CANCELLED']);
    expect(await line('Copper silk')).toMatchObject({
      stockGrams: 1000,
      used30Grams: 0,
    });
    const back = await movements(`?q=${order.orderNumber}`);
    expect(back.items[0]).toMatchObject({ kind: 'RETURNED', grams: 600 });
    // Running the same order line again is refused by the database (one per line).
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const stockItem = await prisma.stockItem.findFirstOrThrow({
      where: { materialId: studio.material.id, colour: 'Copper silk' },
    });
    await expect(
      prisma.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          kind: 'ORDER',
          grams: -600,
          orderItemId: item.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('a failed print loses its filament; a finished one moves only the difference', async () => {
    const customer = await signedInCustomer(app);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const red = (await line('Red')).stockGrams;
    // Going into production planned the line's print by itself, from its red reel.
    const planned = await as(staff.cookie)
      .get(`/print-jobs?orderId=${order.id}`)
      .expect(200);
    expect(planned.body.items).toHaveLength(1);
    const auto = planned.body.items[0];
    expect(auto).toMatchObject({
      status: 'QUEUED',
      quantity: 1,
      reel: { colour: 'Red' },
    });
    const printer = await as(staff.cookie)
      .post('/printers', {
        name: `Stock ${randomUUID().slice(0, 8)}`,
        watts: 150,
        active: true,
      })
      .expect(201);
    await as(staff.cookie)
      .patch(`/print-jobs/${auto.id}`, { printerId: printer.body.id })
      .expect(200);
    for (const body of [
      { status: 'PRINTING' },
      // Exactly the 100 g the order took: nothing more moves.
      { status: 'DONE', actualGrams: '100', actualHours: '1' },
    ])
      await as(staff.cookie).patch(`/print-jobs/${auto.id}`, body).expect(200);
    expect((await line('Red')).stockGrams).toBe(red);
    // The product's real cost per piece now counts that run; customers never see it.
    const real = (
      await as(staff.cookie)
        .get(`/print-jobs/products/${studio.product.id}/cost`)
        .expect(200)
    ).body;
    expect(real.pieces).toBeGreaterThanOrEqual(1);
    expect(Number(real.perPiece.grams)).toBeGreaterThan(0);
    expect(Number(real.perPiece.soldAt)).toBeGreaterThan(0);
    await as(customer.cookie)
      .get(`/print-jobs/products/${studio.product.id}/cost`)
      .expect(403);
    // A reprint that failed: what it used is lost.
    const failed = await as(staff.cookie)
      .post('/print-jobs', {
        orderId: order.id,
        printerId: printer.body.id,
        stockItemId: auto.reel.id,
        quantity: 1,
        grams: '12.3',
        hours: '1',
      })
      .expect(201);
    for (const step of ['PRINTING', 'FAILED'])
      await as(staff.cookie)
        .patch(`/print-jobs/${failed.body.id}`, { status: step })
        .expect(200);
    // 12.3 g rounds up to 13 g.
    expect((await line('Red')).stockGrams).toBe(red - 13);
  });

  it('flags what to restock from the owner’s limits and recent use', async () => {
    const red = await line('Red');
    // Recent use of red: 30 (samples) + 100 (an order) + 13 (a failed print) = 143 g.
    expect(red.used30Grams).toBe(143);
    // Keep at least 900 g, deliveries take 7 days, buy 20 days' worth in 100 g spools.
    await as(staff.cookie)
      .put(`/stock/items/${red.id}`, {
        lowStockGrams: 900,
        spoolGrams: 100,
        leadTimeDays: 7,
        coverDays: 20,
        active: true,
      })
      .expect(204);
    // 950 − 100 (an order) − 13 (a failed print) = 837 g left. 143 g in 30 days: 4.77 g a
    // day. Reorder at 900 + 34 = 934; target 934 + 96 = 1030 → 193 g missing → 2 spools.
    expect(await line('Red')).toMatchObject({
      stockGrams: 837,
      availableGrams: 837,
      dailyUseGrams: '4.8',
      daysLeft: 175,
      reorderPointGrams: 934,
      needsRestock: true,
      suggestSpools: 2,
      suggestGrams: 200,
    });
    // Copper silk: 600 g used for samples, 400 g left → 20 g a day; reorder at 500 (its
    // material's limit) + 140 = 640.
    await as(staff.cookie)
      .post('/stock/movements', {
        materialId: studio.material.id,
        colour: 'Copper silk',
        kind: 'USED',
        grams: 600,
        note: 'Samples',
      })
      .expect(204);
    expect(await line('Copper silk')).toMatchObject({
      lowStockGrams: 500,
      daysLeft: 20,
      needsRestock: true,
    });
    // A colour switched off is never flagged.
    const silk = await line('Copper silk');
    await as(staff.cookie)
      .put(`/stock/items/${silk.id}`, {
        lowStockGrams: 500,
        spoolGrams: 1000,
        leadTimeDays: 7,
        coverDays: 30,
        active: false,
      })
      .expect(204);
    expect(await line('Copper silk')).toMatchObject({
      needsRestock: false,
      suggestSpools: 0,
    });
  });

  it('forms list the filaments in use exactly as the overview shows them', async () => {
    const overview = (await as(staff.cookie).get('/stock').expect(200))
      .body as StockOverview;
    const choices = (await as(staff.cookie).get('/stock/filaments').expect(200))
      .body as FilamentChoice[];
    expect(choices).toEqual(
      overview.items
        .filter((i) => i.active)
        .map((i) => ({
          id: i.id,
          material: i.material.code,
          colour: i.colour,
          swatchHex: i.swatchHex,
          costPerGram: i.costPerGram,
          stockGrams: i.stockGrams,
        })),
    );
    await as((await signedInCustomer(app)).cookie)
      .get('/stock/filaments')
      .expect(403);
  });

  it('only the team sees stock; changing it needs stock.manage', async () => {
    const customer = await signedInCustomer(app);
    await as(customer.cookie).get('/stock').expect(403);
    const designer = await signedInAs(app, Role.DESIGNER);
    await as(designer.cookie).get('/stock').expect(200);
    await as(designer.cookie)
      .post('/stock/movements', {
        materialId: studio.material.id,
        kind: 'RECEIVED',
        grams: 1000,
      })
      .expect(403);
    await as(staff.cookie)
      .get('/stock?from=2026-10-31&to=2026-10-01')
      .expect(400);
  });

  it('a new material’s starting stock is its first movement; editing it never types over stock', async () => {
    const code = `S${studio.tag.toUpperCase()}`;
    const body = {
      code,
      name: 'Opening test',
      pricePerGram: '0.04',
      densityGPerCm3: '1.24',
      gramsPerHour: '12',
      stockGrams: 2500,
      lowStockThresholdGrams: 1000,
      active: true,
    };
    const created = await as(admin.cookie).post('/materials', body).expect(201);
    expect(created.body.stockGrams).toBe(2500);
    const updated = await as(admin.cookie)
      .put(`/materials/${created.body.id}`, { ...body, stockGrams: 99 })
      .expect(200);
    expect(updated.body.stockGrams).toBe(2500);
    const movements = await prisma.stockMovement.findMany({
      where: { stockItem: { materialId: created.body.id } },
    });
    expect(movements).toEqual([
      expect.objectContaining({ kind: 'OPENING', grams: 2500 }),
    ]);
  });

  it('spools received with their price: on the shelf, the material’s cost, booked when paid', async () => {
    const shelfBefore = (await line('Copper silk'))?.stockGrams ?? 0;
    await as(staff.cookie)
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour: 'Copper silk',
        spools: 3,
        spoolGrams: 1000,
        pricePerSpool: '24.00',
        paidFrom: 'CASH',
        updateCost: true,
      })
      .expect(204);
    expect(await line('Copper silk')).toMatchObject({
      stockGrams: shelfBefore + 3000,
      costPerGram: '0.0240',
      swatchHex: '#b87333',
    });
    // The spool's price is the material's cost per gram from now on.
    expect(
      await prisma.material.findUniqueOrThrow({
        where: { id: studio.material.id },
        select: { pricePerGram: true, reelPrice: true, reelGrams: true },
      }),
    ).toMatchObject({ reelGrams: 1000 });
    const material = await prisma.material.findUniqueOrThrow({
      where: { id: studio.material.id },
    });
    expect(material.pricePerGram.toFixed(4)).toBe('0.0240');
    expect(material.reelPrice!.toFixed(2)).toBe('24.00');

    // Paid from the cash box: an expense of $72.00 in the books, linked from the movement.
    const delivery = await prisma.stockMovement.findFirstOrThrow({
      where: {
        stockItem: { materialId: studio.material.id },
        kind: 'RECEIVED',
      },
      orderBy: { id: 'desc' },
      include: {
        journalEntry: { include: { lines: { include: { account: true } } } },
      },
    });
    expect(delivery.cost!.toFixed(2)).toBe('72.00');
    const lines = delivery.journalEntry!.lines;
    expect(
      lines.find((l) => l.account.type === 'EXPENSE')!.debit.toFixed(2),
    ).toBe('72.00');
    expect(
      lines.find((l) => l.account.type === 'CASH')!.credit.toFixed(2),
    ).toBe('72.00');
    const overview = (await as(staff.cookie).get('/stock').expect(200))
      .body as StockOverview;
    expect(overview.canBookPurchases).toBe(true);
    expect((await movements()).items[0]).toMatchObject({
      kind: 'RECEIVED',
      cost: '72.00',
      entryNumber: expect.stringMatching(/^CSH\//),
    });

    // Not paid yet, and kept off pricing: only the grams and their cost.
    await as(staff.cookie)
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour: 'Copper silk',
        spools: 1,
        spoolGrams: 750,
        pricePerSpool: '30.00',
        updateCost: false,
      })
      .expect(204);
    expect(
      (
        await prisma.stockMovement.findFirstOrThrow({
          where: {
            stockItem: { materialId: studio.material.id },
            kind: 'RECEIVED',
          },
          orderBy: { id: 'desc' },
        })
      ).journalEntryId,
    ).toBeNull();
    expect(
      (
        await prisma.material.findUniqueOrThrow({
          where: { id: studio.material.id },
        })
      ).pricePerGram.toFixed(4),
    ).toBe('0.0240');
    // Bad input: no spools, no price, a weight that isn't a spool's.
    for (const bad of [
      { spools: 0 },
      { pricePerSpool: 'free' },
      { spoolGrams: 5 },
      { paidFrom: 'CARD' },
    ]) {
      await as(staff.cookie)
        .post('/stock/receipts', {
          materialId: studio.material.id,
          colour: 'Copper silk',
          spools: 1,
          spoolGrams: 1000,
          pricePerSpool: '20.00',
          ...bad,
        })
        .expect(400);
    }
    await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: staff.user.id, action: 'stock.receive' },
    });
  });

  it('printed for the studio, a failed print and a weighing: grams from the product, costed', async () => {
    const printables = (
      await as(staff.cookie).get('/stock/printables').expect(200)
    ).body as StockPrintable[];
    const vase = printables.find((p) => p.id === studio.product.id)!;
    expect(vase.colours.map((c) => c.label)).toEqual(['Red', 'Copper silk']);
    expect(vase.sizes).toHaveLength(2);
    const wide = vase.sizes[1]!;
    const before = (await line('Copper silk')).stockGrams;

    // Two wide vases for the shop window: 2 × 200 g, at cost with machine time.
    const made = (
      await as(staff.cookie)
        .post('/stock/studio-prints', {
          productId: studio.product.id,
          size: wide,
          colour: 'Copper silk',
          quantity: 2,
          note: 'Shop window',
        })
        .expect(200)
    ).body as { grams: number; cost: string };
    expect(made.grams).toBe(400);
    expect(Number(made.cost)).toBeGreaterThan(400 * 0.024);
    // A failed standard vase that got 40% through: 40 g lost.
    const failed = (
      await as(staff.cookie)
        .post('/stock/failed-prints', {
          productId: studio.product.id,
          colour: 'Copper silk',
          quantity: 1,
          progressPercent: 40,
        })
        .expect(200)
    ).body as { grams: number; cost: string };
    expect(failed.grams).toBe(40);
    expect((await line('Copper silk')).stockGrams).toBe(before - 440);

    const overview = (await as(staff.cookie).get('/stock').expect(200))
      .body as StockOverview;
    expect((await movements()).items[0]).toMatchObject({
      kind: 'FAILED_PRINT',
      product: studio.product.name,
      quantity: 1,
      note: 'Failed at 40%',
    });
    expect(Number(overview.costs.studio.cost)).toBeGreaterThanOrEqual(
      Number(made.cost),
    );
    expect(overview.costs.failed.grams).toBeGreaterThanOrEqual(40);
    expect(Number(overview.costs.bought.cost)).toBeGreaterThanOrEqual(72);

    // Only its own colours and sizes; a colour is needed when it has some.
    for (const bad of [
      { colour: 'Green' },
      { colour: undefined },
      { size: '99 × 99 × 99 cm' },
      { quantity: 0 },
      { progressPercent: 0 },
    ]) {
      await as(staff.cookie)
        .post('/stock/failed-prints', {
          productId: studio.product.id,
          colour: 'Red',
          quantity: 1,
          ...bad,
        })
        .expect(400);
    }

    // Weighed: 2,500 g on the shelf; the difference is recorded, whatever it was.
    const shelf = (await line('Copper silk')).stockGrams;
    const counted = (
      await as(staff.cookie)
        .post('/stock/counts', {
          materialId: studio.material.id,
          colour: 'Copper silk',
          gramsOnShelf: 2500,
        })
        .expect(200)
    ).body as { difference: number };
    expect(counted.difference).toBe(2500 - shelf);
    expect((await line('Copper silk')).stockGrams).toBe(2500);
    // Weighed again with nothing changed: nothing recorded.
    expect(
      (
        await as(staff.cookie)
          .post('/stock/counts', {
            materialId: studio.material.id,
            colour: 'Copper silk',
            gramsOnShelf: 2500,
          })
          .expect(200)
      ).body,
    ).toEqual({ difference: 0 });
    // Customers get none of it.
    const customer = await signedInCustomer(app);
    await as(customer.cookie).get('/stock/printables').expect(403);
    await as(customer.cookie)
      .post('/stock/counts', {
        materialId: studio.material.id,
        gramsOnShelf: 0,
      })
      .expect(403);
  });

  it("lists every movement page by page, one line's or one kind, with counts", async () => {
    const copper = (await line('Copper silk')).id;
    const all: StockMovementView[] = [];
    let cursor = '';
    do {
      const page = await movements(
        `?stockItemId=${copper}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      all.push(...page.items);
      cursor = page.nextCursor ?? '';
    } while (cursor);
    // Every one of the line's movements once, newest first, none of another line's.
    const inDb = await prisma.stockMovement.findMany({
      where: { stockItemId: copper },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    expect(all.map((m) => m.id)).toEqual(inDb.map((m) => m.id));
    expect(all.length).toBeGreaterThan(2);

    const counts = (
      await as(staff.cookie)
        .get(`/stock/movements/counts?stockItemId=${copper}`)
        .expect(200)
    ).body as StockMovementCounts;
    expect(Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)).toBe(
      inDb.length,
    );
    const received = await movements(
      `?stockItemId=${copper}&kinds=RECEIVED&limit=100`,
    );
    expect(received.items.length).toBe(counts.RECEIVED);
    expect(received.items.every((m) => m.kind === 'RECEIVED')).toBe(true);

    // Biggest delivery first by grams; a cursor from another sort is refused.
    const byGrams = await movements(
      `?stockItemId=${copper}&sort=grams&limit=1`,
    );
    expect(byGrams.items[0]!.grams).toBe(Math.max(...all.map((m) => m.grams)));
    // Page by page by grams, it still gives every movement once, biggest first.
    const grams: number[] = [];
    for (let at = ''; ;) {
      const page = await movements(
        `?stockItemId=${copper}&sort=grams&limit=2${at ? `&cursor=${at}` : ''}`,
      );
      grams.push(...page.items.map((m) => m.grams));
      if (!page.nextCursor) break;
      at = page.nextCursor;
    }
    expect(grams).toEqual(all.map((m) => m.grams).sort((a, b) => b - a));
    await as(staff.cookie)
      .get(`/stock/movements?sort=createdAt&cursor=${byGrams.nextCursor}`)
      .expect(400);
  });
});
