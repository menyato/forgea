import type {
  OrderProduction,
  OrderRemovalPreview,
  Page,
  PieceCounts,
  PieceDetail,
  PieceView,
  PricePreview,
  PrintJobListItem,
  StockOverview,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { studioDay } from '../src/common/studio-day.js';
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

/**
 * "Where it is": every print goes on the board (studio prints, failed prints, an order line's
 * runs) with the day it was printed; a print still on the printer waits there and takes its
 * filament when done; the team moves pieces and says who has them, by name and by account.
 * Products carry extra costs; an order says which filament it lacks; a test order can be
 * removed entirely by an admin.
 */
describe('Where it is: pieces, extra costs, the shelf, test orders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let staff: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;
  let printerId: string;

  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  const redOnShelf = async () =>
    (
      (await as(admin.cookie).get('/stock').expect(200)).body as StockOverview
    ).items.find(
      (i) => i.material.id === studio.material.id && i.colour === 'Red',
    )!.stockGrams;
  const mine = async (query = '') =>
    (
      (
        await as(admin.cookie)
          .get(`/pieces?q=${studio.tag}${query}`)
          .expect(200)
      ).body as Page<PieceView>
    ).items;
  const studioPrint = (body: object) =>
    as(staff.cookie).post('/stock/studio-prints', {
      productId: studio.product.id,
      colour: 'Red',
      quantity: 1,
      toShelf: false,
      ...body,
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    staff = await signedInAs(app, Role.STAFF);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
    await as(admin.cookie)
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour: 'Red',
        spools: 2,
        spoolGrams: 1000,
        pricePerSpool: '50.00',
        updateCost: false,
      })
      .expect(204);
    printerId = (
      await as(staff.cookie)
        .post('/printers', {
          name: `Board ${randomUUID().slice(0, 8)}`,
          watts: 200,
          active: true,
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('a studio print goes on the board, on the day it was printed, with its filament and cost', async () => {
    const before = await redOnShelf();
    const { body } = await studioPrint({
      printedOn: '2026-11-07',
      note: `For the lab ${studio.tag}`,
    }).expect(200);
    expect(body.pieceId).toEqual(expect.any(String));
    expect(await redOnShelf()).toBe(before - 100);
    const piece = (
      await as(admin.cookie).get(`/pieces/${body.pieceId}`).expect(200)
    ).body as PieceDetail;
    expect(piece).toMatchObject({
      stage: 'IN_LAB',
      quantity: 1,
      grams: 100,
      cost: '13.00',
      productId: studio.product.id,
    });
    expect(studioDay(new Date(piece.printedAt))).toBe('2026-11-07');
    expect(piece.moves).toHaveLength(1);
    // Its filament records point at it.
    expect(
      await prisma.stockMovement.count({ where: { pieceId: piece.id } }),
    ).toBe(1);
  });

  it('a print still on the printer waits on the board; its filament comes off when it is done', async () => {
    const before = await redOnShelf();
    const { body } = await studioPrint({
      printing: true,
      note: `Printing ${studio.tag}`,
    }).expect(200);
    expect(await redOnShelf()).toBe(before);
    const id = body.pieceId as string;
    let piece = (await as(admin.cookie).get(`/pieces/${id}`).expect(200))
      .body as PieceDetail;
    expect(piece.stage).toBe('PRINTING');
    expect(piece.plan).toMatchObject({ quantity: 1 });
    // Moved by hand while printing: refused; it is finished from its page.
    await as(staff.cookie)
      .patch(`/pieces/${id}`, { stage: 'IN_LAB' })
      .expect(400);
    await as(staff.cookie).post(`/pieces/${id}/finish`, {}).expect(201);
    piece = (await as(admin.cookie).get(`/pieces/${id}`).expect(200))
      .body as PieceDetail;
    expect(piece).toMatchObject({ stage: 'IN_LAB', grams: 100, plan: null });
    expect(await redOnShelf()).toBe(before - 100);
    // Done twice: refused, nothing taken twice.
    await as(staff.cookie).post(`/pieces/${id}/finish`, {}).expect(409);
    expect(await redOnShelf()).toBe(before - 100);

    // One that fails half way: as far as it got, counted as lost.
    const failing = (
      await studioPrint({ printing: true, note: `Failing ${studio.tag}` })
    ).body.pieceId as string;
    await as(staff.cookie)
      .post(`/pieces/${failing}/finish`, { failed: true, progressPercent: 50 })
      .expect(201);
    const failed = (
      await as(admin.cookie).get(`/pieces/${failing}`).expect(200)
    ).body as PieceDetail;
    expect(failed).toMatchObject({ stage: 'FAILED', grams: 50 });
    expect(await redOnShelf()).toBe(before - 150);
  });

  it('the team moves a piece and says who has it, by name and by account; every move is kept', async () => {
    const id = (await studioPrint({ note: `Gift ${studio.tag}` })).body
      .pieceId as string;
    const mira = await signedInCustomer(app);
    const customer = await signedInCustomer(app);
    // Customers see no board, and can't move anything.
    await as(customer.cookie).get('/pieces').expect(403);
    await as(customer.cookie)
      .patch(`/pieces/${id}`, { stage: 'GIVEN' })
      .expect(403);
    // An account that doesn't exist: refused.
    await as(staff.cookie)
      .patch(`/pieces/${id}`, { stage: 'GIVEN', holderId: randomUUID() })
      .expect(400);
    await as(staff.cookie)
      .patch(`/pieces/${id}`, {
        stage: 'GIVEN',
        holder: 'Mira',
        holderId: mira.user.id,
        note: '1 white and light brown',
        printedOn: '2026-11-08',
      })
      .expect(200);
    const given = (await as(admin.cookie).get(`/pieces/${id}`).expect(200))
      .body as PieceDetail;
    expect(given).toMatchObject({
      stage: 'GIVEN',
      holder: 'Mira',
      holderAccount: { id: mira.user.id },
      note: '1 white and light brown',
    });
    expect(studioDay(new Date(given.printedAt))).toBe('2026-11-08');
    expect(given.moves.map((m) => m.stage)).toEqual(['IN_LAB', 'GIVEN']);
    // Their pieces, by account.
    const held = (
      await as(admin.cookie).get(`/pieces?holderId=${mira.user.id}`).expect(200)
    ).body as Page<PieceView>;
    expect(held.items.map((p) => p.id)).toEqual([id]);
    // Back in the lab: nobody holds it.
    await as(staff.cookie)
      .patch(`/pieces/${id}`, { stage: 'IN_LAB' })
      .expect(200);
    const back = (await as(admin.cookie).get(`/pieces/${id}`).expect(200))
      .body as PieceDetail;
    expect(back).toMatchObject({ holder: null, holderAccount: null });
    expect(back.moves).toHaveLength(3);
    // A move's history is never rewritten.
    await expect(
      prisma.pieceMove.updateMany({
        where: { pieceId: id },
        data: { note: 'changed' },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('the board filters by stage and by the days printed, and counts them', async () => {
    const all = await mine();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const inLab = await mine('&stages=IN_LAB');
    expect(inLab.every((p) => p.stage === 'IN_LAB')).toBe(true);
    const onTheSeventh = await mine('&from=2026-11-07&to=2026-11-07');
    expect(onTheSeventh.map((p) => p.note)).toEqual([
      `For the lab ${studio.tag}`,
    ]);
    const counts = (
      await as(admin.cookie)
        .get(`/pieces/counts?q=${studio.tag}&from=2026-11-07&to=2026-11-07`)
        .expect(200)
    ).body as PieceCounts;
    expect(counts).toMatchObject({
      stages: { IN_LAB: 1 },
      pieces: 1,
      grams: 100,
      cost: '13.00',
    });
  });

  it("an order line goes on the board when its run is done: a paid order's is sold to its customer", async () => {
    const customer = await signedInCustomer(app);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 2 },
      { paymentMethod: 'COD', delivery: false },
    );
    // Before production: what it needs against the shelf.
    const production = (
      await as(admin.cookie).get(`/orders/${order.id}/production`).expect(200)
    ).body as OrderProduction;
    expect(production.shelf).toEqual([
      {
        material: studio.material.code,
        colour: 'Red',
        needed: 200,
        onShelf: await redOnShelf(),
        short: false,
      },
    ]);
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const [job] = (
      (
        await as(staff.cookie)
          .get(`/print-jobs?orderId=${order.id}`)
          .expect(200)
      ).body as Page<PrintJobListItem>
    ).items;
    await as(staff.cookie)
      .patch(`/print-jobs/${job!.id}`, { printerId, status: 'PRINTING' })
      .expect(200);
    await as(staff.cookie)
      .patch(`/print-jobs/${job!.id}`, {
        status: 'DONE',
        actualGrams: '210',
        actualHours: '10',
      })
      .expect(200);
    const pieces = (
      (await as(admin.cookie).get(`/pieces?q=${order.orderNumber}`).expect(200))
        .body as Page<PieceView>
    ).items;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      orderNumber: order.orderNumber,
      quantity: 2,
      stage: 'SOLD',
      grams: 210,
      holderAccount: { id: customer.user.id },
    });
    // The order's page asks for exactly its own pieces.
    const own = (
      (await as(admin.cookie).get(`/pieces?orderId=${order.id}`).expect(200))
        .body as Page<PieceView>
    ).items;
    expect(own.map((p) => p.id)).toEqual([pieces[0]!.id]);
  });

  it('an order says when a colour it needs has no reel on the shelf', async () => {
    const customer = await signedInCustomer(app);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'silk', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    const production = (
      await as(admin.cookie).get(`/orders/${order.id}/production`).expect(200)
    ).body as OrderProduction;
    expect(production.shelf).toEqual([
      {
        material: studio.material.code,
        colour: 'Copper silk',
        needed: 100,
        onShelf: null,
        short: true,
      },
    ]);
  });

  it("a product's extra costs add to its cost, and so to its price", async () => {
    const product = (
      await as(admin.cookie)
        .get(`/products/manage/${studio.product.id}`)
        .expect(200)
    ).body as { extraCosts: unknown[] };
    expect(product.extraCosts).toEqual([]);
    const preview = (extraCosts?: object[]) =>
      as(admin.cookie)
        .post('/products/price-preview', {
          materialId: studio.material.id,
          grams: '100',
          printHours: '5',
          ...(extraCosts ? { extraCosts } : {}),
        })
        .expect(200)
        .then((r) => r.body as PricePreview);
    const plain = await preview();
    const withRing = await preview([{ label: 'Key ring', amount: '0.50' }]);
    expect(withRing.breakdown?.extras).toBe('0.50');
    expect(Number(withRing.breakdown?.cost)).toBeCloseTo(
      Number(plain.breakdown?.cost) + 0.5,
    );
    // 100% profit: the ring adds twice its cost to the price.
    expect(Number(withRing.unitPrice)).toBeCloseTo(Number(plain.unitPrice) + 1);
    await as(admin.cookie)
      .post('/products/price-preview', {
        materialId: studio.material.id,
        grams: '100',
        printHours: '5',
        extraCosts: [{ label: '', amount: '0.50' }],
      })
      .expect(400);
  });

  it('an admin removes a test order entirely: its documents, runs and filament go with it', async () => {
    const customer = await signedInCustomer(app);
    const before = await redOnShelf();
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    await moveOrder(app, staff.cookie, order.id, TO_DELIVERED(false));
    expect(await redOnShelf()).toBe(before - 100);
    // Only admins, and only with its number typed again.
    await as(staff.cookie).get(`/orders/${order.id}/removal`).expect(403);
    await as(staff.cookie)
      .post(`/orders/${order.id}/remove`, { confirm: order.orderNumber })
      .expect(403);
    const preview = (
      await as(admin.cookie).get(`/orders/${order.id}/removal`).expect(200)
    ).body as OrderRemovalPreview;
    expect(preview).toMatchObject({
      orderNumber: order.orderNumber,
      lines: 1,
      blockedBy: [],
    });
    expect(preview.stockMovements).toBeGreaterThan(0);
    await as(admin.cookie)
      .post(`/orders/${order.id}/remove`, { confirm: 'FG-0000-0000' })
      .expect(400);
    await as(admin.cookie)
      .post(`/orders/${order.id}/remove`, { confirm: order.orderNumber })
      .expect(201);
    expect(await prisma.order.count({ where: { id: order.id } })).toBe(0);
    expect(
      await prisma.journalEntry.count({ where: { orderId: order.id } }),
    ).toBe(0);
    expect(await redOnShelf()).toBe(before);
    // Outside that one removal, the books still refuse deletes.
    const posted = await prisma.journalEntry.findFirst({
      where: { state: 'POSTED' },
    });
    if (posted)
      await expect(
        prisma.journalEntry.delete({ where: { id: posted.id } }),
      ).rejects.toThrow();
  });

  it('an order made from a quotation is removed with its quotation, and the history still refuses deletes', async () => {
    const quotation = (
      await as(admin.cookie)
        .post('/quotations', {
          customerEmail: `test-${randomUUID().slice(0, 8)}@example.com`,
          validUntil: '2099-12-31',
          customerName: 'A test',
          phone: '70 904 044',
          paymentMethod: 'TRANSFER',
          delivery: false,
          lines: [{ description: 'Test piece', quantity: 1, unitPrice: '5' }],
        })
        .expect(201)
    ).body as { id: string; number: string };
    await as(admin.cookie)
      .post(`/quotations/${quotation.id}/confirm`)
      .expect(200);
    const { orderId } = (
      await as(admin.cookie).get(`/quotations/${quotation.id}`).expect(200)
    ).body as { orderId: string };
    const preview = (
      await as(admin.cookie).get(`/orders/${orderId}/removal`).expect(200)
    ).body as OrderRemovalPreview;
    expect(preview.blockedBy).toEqual([]);
    expect(preview.madeFrom).toEqual([`quotation ${quotation.number}`]);
    await as(admin.cookie)
      .post(`/orders/${orderId}/remove`, { confirm: preview.orderNumber })
      .expect(201);
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(0);
    expect(await prisma.quotation.count({ where: { id: quotation.id } })).toBe(
      0,
    );
    // Another quotation's history is still append-only.
    const kept = await prisma.quotationStatusHistory.findFirst();
    if (kept)
      await expect(
        prisma.quotationStatusHistory.delete({ where: { id: kept.id } }),
      ).rejects.toThrow();
  });
});
