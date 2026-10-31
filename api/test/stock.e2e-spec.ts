import type { StockItemView, StockOverview } from '@forgea/types';
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

  it('takes an order’s grams at production, never when cancelled before it, never twice', async () => {
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
    const overview = (await as(staff.cookie).get('/stock').expect(200))
      .body as StockOverview;
    expect(overview.movements).toContainEqual(
      expect.objectContaining({
        kind: 'ORDER',
        grams: -600,
        colour: 'Copper silk',
        orderNumber: order.orderNumber,
      }),
    );
    // Cancelled after production started: the filament is spent.
    await moveOrder(app, staff.cookie, order.id, ['CANCELLED']);
    expect((await line('Copper silk')).stockGrams).toBe(400);
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

  it('a failed print loses its filament; a finished one changes nothing', async () => {
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
    const job = async (status: 'DONE' | 'FAILED') => {
      const created = await as(staff.cookie)
        .post('/print-jobs', {
          orderId: order.id,
          materialId: studio.material.id,
          color: 'Red',
          grams: '12.3',
          hours: '1',
          machine: 'Printer 1',
        })
        .expect(201);
      for (const step of ['PRINTING', status])
        await as(staff.cookie)
          .patch(`/print-jobs/${created.body.id}`, { status: step })
          .expect(200);
    };
    await job('DONE');
    expect((await line('Red')).stockGrams).toBe(red);
    await job('FAILED');
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
    // Copper silk: 400 g left; 600 g used → 20 g a day; reorder at 500 (its material's
    // limit) + 140 = 640.
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
});
