import type {
  CustomRequestView,
  PrintFile,
  QuotationDetail,
  QuotationPrintFileView,
  StaffOrder,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  cubeStl,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { createStudio, moveOrder } from './studio-helpers.js';
import { bambuThreeMf } from './three-mf-file.js';

const checkoutForm = () => ({
  idempotencyKey: randomUUID(),
  name: 'Rana Khoury',
  phone: '70 123 456',
  paymentMethod: 'TRANSFER',
  delivery: false,
});

/** Reads a response's bytes as they are (supertest parses only text and JSON). */
const binary = (
  res: request.Response,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/**
 * Sales made from a 3MF: a quotation line the team prices from a file, and a customer's custom
 * request with a sliced file quoted at once. Their orders take each colour's grams from stock
 * and the studio downloads the file from the order.
 */
describe('3MF quotations and custom requests (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    upload: (url: string, bytes: Buffer, name: string) =>
      http()
        .post(url)
        .set(CSRF)
        .set('Cookie', cookie)
        .attach('file', bytes, name),
  });
  /** Stock taken by an order line, by colour. */
  const taken = async (orderItemId: string) =>
    Object.fromEntries(
      (
        await prisma.stockMovement.findMany({
          where: { orderItemId, kind: 'ORDER' },
          include: { stockItem: true },
        })
      ).map((m) => [m.stockItem.colour, m.grams]),
    );

  let studio: Awaited<ReturnType<typeof createStudio>>;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    // Its colours (#aa2222 Red, #b87333 Copper silk) are the file's.
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: { autoQuoteSlicedFiles: true },
    });
    await app.close();
  });

  it('a quotation line priced from a 3MF: confirmed, its order takes each colour and downloads the file', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const designer = await signedInAs(app, Role.DESIGNER);
    const customer = await signedInCustomer(app);
    const s = as(staff.cookie);

    const bytes = bambuThreeMf({ sliced: true });
    // Whoever writes quotations uploads it; nobody else.
    await as(designer.cookie)
      .upload('/uploads/quotation-file', bytes, 'piece.gcode.3mf')
      .expect(403);
    const key = (
      await s
        .upload('/uploads/quotation-file', bytes, 'piece.gcode.3mf')
        .expect(201)
    ).body.key as string;
    // The file stays the team's.
    await as(customer.cookie).get(`/media/${key}`).expect(404);
    await s.get(`/media/${key}`).expect(200);

    const read = (await s.post('/quotations/print-file', { key }).expect(200))
      .body as QuotationPrintFileView;
    expect(read.printFile).toMatchObject({
      fileKey: key,
      sliced: true,
      grams: '12.50',
      printHours: '1.50',
    });
    expect(read.printFile.colours.map((c) => [c.hex, c.grams])).toEqual([
      ['#aa2222', '10.25'],
      ['#b87333', '2.25'],
    ]);
    expect(read.size).toEqual({ x: '3.0', y: '2.0', z: '2.0' });
    expect(Number(read.unitPrice)).toBeGreaterThan(0);
    expect(read.materials[0]!.id).toBe(read.printFile.materialId);
    // Only quotation files, only for whoever writes quotations.
    const product = (
      await as((await signedInAs(app, Role.ADMIN)).cookie)
        .upload('/uploads/product-model', bytes, 'p.3mf')
        .expect(201)
    ).body.key as string;
    await s.post('/quotations/print-file', { key: product }).expect(400);
    await as(designer.cookie)
      .post('/quotations/print-file', { key })
      .expect(403);

    const form = {
      customerEmail: customer.user.email,
      validUntil: '2099-12-31',
      customerName: 'Karim Haddad',
      phone: '70 111 222',
      paymentMethod: 'TRANSFER',
      delivery: false,
      lines: [
        {
          description: 'Two-colour piece',
          quantity: 3,
          unitPrice: read.unitPrice,
          isCustom: true,
          sizeXcm: read.size.x,
          sizeYcm: read.size.y,
          sizeZcm: read.size.z,
          printFileKey: key,
          printMaterialId: read.printFile.materialId,
        },
      ],
    };
    // A file the team never uploaded for a quotation is refused.
    await s
      .post('/quotations', {
        ...form,
        lines: [{ ...form.lines[0], printFileKey: product }],
      })
      .expect(400);
    // The line's numbers come from the file, whatever the browser says.
    const created = (await s.post('/quotations', form).expect(201))
      .body as QuotationDetail;
    const line = created.lines[0]!.printFile as PrintFile;
    expect(line).toEqual(read.printFile);

    // The customer's view never carries the file.
    await s.post(`/quotations/${created.id}/send`).expect(200);
    const mine = (
      await as(customer.cookie)
        .get(`/quotations/mine/${created.number}`)
        .expect(200)
    ).body as QuotationDetail;
    expect(mine.lines[0]!.printFile).toBeNull();

    // Confirmed: the order line keeps the file, production takes each colour × 3.
    await s.post(`/quotations/${created.id}/confirm`).expect(200);
    const order = await prisma.order.findFirstOrThrow({
      where: { quotation: { id: created.id } },
      include: { items: true },
    });
    const item = order.items[0]!;
    expect(item.printFile).toEqual(read.printFile);
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    expect(await taken(item.id)).toEqual({
      [line.colours[0]!.colour]: -31,
      [line.colours[1]!.colour]: -7,
    });

    const view = (await s.get(`/orders/${order.id}`).expect(200))
      .body as StaffOrder;
    expect(view.items[0]!.printProject).toBe(true);
    const file = await s
      .get(`/orders/${order.id}/items/${item.id}/project`)
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect('Content-Type', 'model/3mf');
    expect(Buffer.compare(file.body as Buffer, bytes)).toBe(0);
  });

  it('a custom request costs what the shop charges for the same file printed from the same reels', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const staff = as(admin.cookie);
    // Two reels of the studio's material at their own prices, coloured as the file is.
    for (const [colour, hex, price] of [
      ['Red', '#aa2222', '30.00'],
      ['Copper silk', '#b87333', '45.00'],
    ] as const)
      await staff
        .post('/stock/receipts', {
          materialId: studio.material.id,
          colour,
          hex,
          spools: 1,
          spoolGrams: 1000,
          pricePerSpool: price,
          updateCost: false,
        })
        .expect(204);
    const reels = await prisma.stockItem.findMany({
      where: {
        materialId: studio.material.id,
        colour: { in: ['Red', 'Copper silk'] },
      },
    });
    const reel = (c: string) => reels.find((r) => r.colour === c)!.id;

    const customer = await signedInCustomer(app);
    const key = (
      await as(customer.cookie)
        .upload(
          '/custom-requests/files',
          bambuThreeMf({ sliced: true }),
          'same.gcode.3mf',
        )
        .expect(201)
    ).body.key as string;
    const estimate = (
      await as(customer.cookie)
        .post('/custom-requests/estimate', {
          fileKey: key,
          quantity: 1,
          materialId: studio.material.id,
        })
        .expect(200)
    ).body.estimate as { price: string; low: string; high: string };

    // The same piece as a product: the file's grams and time, each colour from its reel.
    const shop = (
      await staff
        .post('/products/price-preview', {
          materialId: studio.material.id,
          grams: '12.5',
          printHours: '1.5',
          modelFileKey: key,
          colours: [
            { grams: '10.25', stockItemId: reel('Red') },
            { grams: '2.25', stockItemId: reel('Copper silk') },
          ],
        })
        .expect(200)
    ).body as { calculatedPrice: string };
    expect(estimate.price).toBe(shop.calculatedPrice);
    expect(Number(estimate.low)).toBeLessThan(Number(shop.calculatedPrice));
    expect(Number(estimate.high)).toBeGreaterThan(Number(shop.calculatedPrice));
  });

  it('a customer’s sliced 3MF is quoted at once at its exact price, and their order takes it from stock', async () => {
    const customer = await signedInCustomer(app);
    const me = as(customer.cookie);
    const key = (
      await me
        .upload(
          '/custom-requests/files',
          bambuThreeMf({ sliced: true }),
          'mine.gcode.3mf',
        )
        .expect(201)
    ).body.key as string;
    const estimate = (
      await me
        .post('/custom-requests/estimate', { fileKey: key, quantity: 2 })
        .expect(200)
    ).body.estimate as {
      low: string;
      high: string;
      price: string;
      exact: boolean;
    };
    // The slicer's own numbers, shown as a range around the price itself.
    expect(estimate.exact).toBe(true);
    expect(Number(estimate.low)).toBeLessThan(Number(estimate.price));
    expect(Number(estimate.high)).toBeGreaterThan(Number(estimate.price));

    const created = (
      await me
        .post('/custom-requests', {
          title: 'Two-colour piece',
          description: 'Printed as my sliced file says, two of them.',
          quantity: 2,
          fileKey: key,
        })
        .expect(201)
    ).body as CustomRequestView;
    expect(created.status).toBe('QUOTED');
    expect(created.quote).toMatchObject({ price: estimate.price });
    expect(created.file).toEqual({ key, kind: 'model' });
    const row = await prisma.customRequest.findUniqueOrThrow({
      where: { requestNumber: created.requestNumber },
      include: { statusHistory: { orderBy: { changedAt: 'asc' } } },
    });
    expect(row.quotedByUserId).toBeNull();
    expect(row.statusHistory.map((h) => h.status)).toEqual([
      'SUBMITTED',
      'QUOTED',
    ]);

    await me
      .post(`/custom-requests/mine/${created.requestNumber}/accept`, {
        ...checkoutForm(),
        quotedPrice: estimate.price,
      })
      .expect(201);
    const order = await prisma.order.findFirstOrThrow({
      where: { customRequest: { id: row.id } },
      include: { items: true },
    });
    const item = order.items[0]!;
    // One line for the whole request: the file's grams for both pieces.
    expect(item.printFile).toMatchObject({ fileKey: key, grams: '25.00' });
    const staff = await signedInAs(app, Role.STAFF);
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    expect(Object.values(await taken(item.id)).sort()).toEqual([-21, -5]);
  });

  it('a file never sliced gets a range and waits for the studio; so does a sliced one when the owner says so', async () => {
    const customer = await signedInCustomer(app);
    const me = as(customer.cookie);
    const send = async (sliced: boolean) => {
      const key = (
        await me
          .upload(
            '/custom-requests/files',
            bambuThreeMf({ sliced }),
            'mine.3mf',
          )
          .expect(201)
      ).body.key as string;
      return (
        await me
          .post('/custom-requests', {
            title: 'Two-colour piece',
            description: 'Printed from my project file, please.',
            quantity: 1,
            fileKey: key,
          })
          .expect(201)
      ).body as CustomRequestView;
    };
    const project = await send(false);
    expect(project.status).toBe('SUBMITTED');
    expect(Number(project.estimate!.high)).toBeGreaterThan(
      Number(project.estimate!.low),
    );

    await prisma.storeSettings.update({
      where: { id: 1 },
      data: { autoQuoteSlicedFiles: false },
    });
    const waiting = await send(true);
    expect(waiting.status).toBe('SUBMITTED');
    expect(Number(waiting.estimate!.high)).toBeGreaterThan(
      Number(waiting.estimate!.low),
    );

    // An STL still gets its range, as before.
    const stl = (
      await me
        .upload('/custom-requests/files', cubeStl(30), 'c.stl')
        .expect(201)
    ).body.key as string;
    const range = (
      await me
        .post('/custom-requests/estimate', { fileKey: stl, quantity: 1 })
        .expect(200)
    ).body.estimate as { exact: boolean };
    expect(range.exact).toBe(false);
  });
});
