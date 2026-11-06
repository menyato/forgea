import type {
  Page,
  PrintJobListItem,
  ProductionResults,
  ReadyPieceDetail,
  ReadyPieceView,
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
 * What comes out of the printer: good, spare and bad pieces, reprints of what's missing,
 * orders cancelled mid-production, the ready pieces nobody bought yet, and what was lost.
 */
describe('Production results and ready pieces (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let staff: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;
  let printerId: string;

  const jobsOf = async (orderId: string) =>
    (
      (await as(staff.cookie).get(`/print-jobs?orderId=${orderId}`).expect(200))
        .body as Page<PrintJobListItem>
    ).items;
  const inProduction = async (quantity: number) => {
    const customer = await signedInCustomer(app);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity },
      { paymentMethod: 'COD', delivery: false },
    );
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const [job] = await jobsOf(order.id);
    await as(staff.cookie)
      .patch(`/print-jobs/${job!.id}`, { printerId })
      .expect(200);
    return { order, job: job! };
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    staff = await signedInAs(app, Role.STAFF);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
    printerId = (
      await as(staff.cookie)
        .post('/printers', {
          name: `Results ${randomUUID().slice(0, 8)}`,
          watts: 200,
          active: true,
        })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('a plate with a bad piece and a spare: the bad one is reprinted, the spare waits on the shelf', async () => {
    const { order, job } = await inProduction(3);
    await as(staff.cookie)
      .patch(`/print-jobs/${job.id}`, { status: 'PRINTING' })
      .expect(200);
    // More good pieces than it was for: refused (spares are counted apart).
    await as(staff.cookie)
      .patch(`/print-jobs/${job.id}`, {
        status: 'DONE',
        actualGrams: '330',
        actualHours: '3',
        goodPieces: 4,
      })
      .expect(400);
    const done = (
      await as(staff.cookie)
        .patch(`/print-jobs/${job.id}`, {
          status: 'DONE',
          actualGrams: '330',
          actualHours: '3',
          goodPieces: 2,
          sparePieces: 1,
          actualKwh: '0.5',
          note: 'One warped at the corner',
        })
        .expect(200)
    ).body as PrintJobListItem;
    expect(done).toMatchObject({
      goodPieces: 2,
      sparePieces: 1,
      note: 'One warped at the corner',
    });
    // The energy the printer reported, not watts × hours (which would be 0.6 kWh).
    expect(done.cost!.electricityKwh).toBe('0.5');
    expect(done.reprints).toHaveLength(1);
    // Done twice (a double click): refused, nothing doubles.
    await as(staff.cookie)
      .patch(`/print-jobs/${job.id}`, {
        status: 'DONE',
        actualGrams: '330',
        actualHours: '3',
      })
      .expect(409);

    const reprint = (await jobsOf(order.id)).find((j) => j.id !== job.id)!;
    expect(reprint).toMatchObject({
      status: 'QUEUED',
      quantity: 1,
      replaces: job.id,
      printer: { id: printerId },
    });
    // The spare is on the shelf, at the run's cost per piece printed.
    const spare = await prisma.readyPieceMovement.findMany({
      where: { printJobId: job.id },
    });
    expect(spare).toHaveLength(1);
    expect(spare[0]).toMatchObject({ kind: 'PRINTED', quantity: 1 });
    const total = Number(done.cost!.total);
    expect(Number(spare[0]!.unitCost)).toBeCloseTo(total / 3, 2);

    // The reprint uses filament beyond the estimate: all of it leaves stock when done.
    await as(staff.cookie)
      .patch(`/print-jobs/${reprint.id}`, { status: 'PRINTING' })
      .expect(200);
    await as(staff.cookie)
      .patch(`/print-jobs/${reprint.id}`, {
        status: 'DONE',
        actualGrams: '105',
        actualHours: '1',
      })
      .expect(200);
    const extra = await prisma.stockMovement.findFirstOrThrow({
      where: { printJobId: reprint.id },
    });
    expect(extra).toMatchObject({ kind: 'PRINTED', grams: -105 });
  });

  it('an order cancelled mid-production: runs not started stop, unprinted filament comes back, printed pieces go to the shelf', async () => {
    const { order, job } = await inProduction(2);
    const second = await inProduction(1);
    await as(staff.cookie)
      .patch(`/print-jobs/${job.id}`, { status: 'PRINTING' })
      .expect(200);
    // A stale page (it still shows CONFIRMED): refused.
    await as(staff.cookie)
      .patch(`/orders/${order.id}/status`, {
        status: 'CANCELLED',
        expectedStatus: 'CONFIRMED',
      })
      .expect(409);
    // The other order's run never started: cancelling gives its 100 g back.
    await as(staff.cookie)
      .patch(`/orders/${second.order.id}/status`, {
        status: 'CANCELLED',
        expectedStatus: 'IN_PRODUCTION',
      })
      .expect(200);
    expect((await jobsOf(second.order.id))[0]!.status).toBe('CANCELLED');
    const back = await prisma.stockMovement.findFirstOrThrow({
      where: {
        kind: 'RETURNED',
        note: { contains: second.order.orderNumber },
      },
    });
    expect(back.grams).toBe(100);

    // This one is printing: nothing comes back, and its pieces go to the shelf when done.
    await as(staff.cookie)
      .patch(`/orders/${order.id}/status`, { status: 'CANCELLED' })
      .expect(200);
    expect(
      await prisma.stockMovement.count({
        where: { kind: 'RETURNED', note: { contains: order.orderNumber } },
      }),
    ).toBe(0);
    await as(staff.cookie)
      .patch(`/print-jobs/${job.id}`, {
        status: 'DONE',
        actualGrams: '200',
        actualHours: '2',
      })
      .expect(200);
    const leftOver = await prisma.readyPieceMovement.findFirstOrThrow({
      where: { printJobId: job.id },
    });
    expect(leftOver).toMatchObject({ kind: 'LEFT_OVER', quantity: 2 });
    // No reprint for a cancelled order.
    expect(await jobsOf(order.id)).toHaveLength(1);
  });

  it('ready pieces are sold, counted and never taken below zero; customers never see them', async () => {
    const customer = await signedInCustomer(app);
    await as(customer.cookie).get('/ready-pieces').expect(403);
    const name = `Wedding favour ${randomUUID().slice(0, 6)}`;
    // A custom design kept on the shelf, added by hand.
    await as(staff.cookie).post('/ready-pieces', { quantity: 5 }).expect(400);
    await as(staff.cookie)
      .post('/ready-pieces', {
        name,
        details: 'Gold, 6 cm',
        quantity: 5,
        unitCost: '2.00',
      })
      .expect(204);
    // More of the same, dearer: the average cost follows.
    await as(staff.cookie)
      .post('/ready-pieces', {
        name,
        details: 'Gold, 6 cm',
        quantity: 5,
        unitCost: '4.00',
      })
      .expect(204);
    const shelf = (await as(staff.cookie).get('/ready-pieces').expect(200))
      .body as ReadyPieceView[];
    const piece = shelf.find((p) => p.name === name)!;
    expect(piece).toMatchObject({
      onHand: 10,
      unitCost: '3.00',
      value: '30.00',
    });

    const sold = (
      await as(staff.cookie)
        .post(`/ready-pieces/${piece.id}/take`, {
          kind: 'SOLD',
          quantity: 4,
          note: 'Market stall',
        })
        .expect(200)
    ).body as ReadyPieceDetail;
    expect(sold.onHand).toBe(6);
    // Two people taking the last pieces at once: only what's there can go.
    const results = await Promise.all(
      [1, 2].map(() =>
        as(staff.cookie).post(`/ready-pieces/${piece.id}/take`, {
          kind: 'SCRAPPED',
          quantity: 4,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const counted = (
      await as(staff.cookie)
        .post(`/ready-pieces/${piece.id}/count`, { counted: 3 })
        .expect(200)
    ).body as ReadyPieceDetail;
    expect(counted.onHand).toBe(3);
    expect(counted.movements.map((m) => m.kind)).toEqual([
      'COUNTED',
      'SCRAPPED',
      'SOLD',
      'ADDED',
      'ADDED',
    ]);
    // The history is never rewritten.
    await expect(
      prisma.readyPieceMovement.deleteMany({
        where: { readyPieceId: piece.id },
      }),
    ).rejects.toThrow();
  });

  it('a studio print made to sell goes on the shelf', async () => {
    const before = await prisma.readyPiece.aggregate({
      where: { productId: studio.product.id },
      _sum: { onHand: true },
    });
    await as(staff.cookie)
      .post('/stock/studio-prints', {
        productId: studio.product.id,
        colour: 'Red',
        quantity: 2,
        toShelf: true,
      })
      .expect(200);
    const after = await prisma.readyPiece.aggregate({
      where: { productId: studio.product.id },
      _sum: { onHand: true },
    });
    expect((after._sum.onHand ?? 0) - (before._sum.onHand ?? 0)).toBe(2);
  });

  it('the results show what was made, lost and left on the shelf', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const r = (
      await as(staff.cookie)
        .get(`/print-jobs/results?from=${day}&to=${day}`)
        .expect(200)
    ).body as ProductionResults;
    expect(r.runs.done).toBeGreaterThanOrEqual(3);
    expect(r.pieces.lost).toBeGreaterThanOrEqual(1);
    expect(r.pieces.spare).toBeGreaterThanOrEqual(1);
    expect(Number(r.cost.lost)).toBeGreaterThan(0);
    expect(Number(r.grams.lost)).toBeGreaterThan(0);
    expect(r.printers.find((p) => p.id === printerId)).toMatchObject({
      runs: 3,
    });
    expect(r.shelf.pieces).toBeGreaterThanOrEqual(3);
    await as((await signedInCustomer(app)).cookie)
      .get('/print-jobs/results')
      .expect(403);
  });
});
