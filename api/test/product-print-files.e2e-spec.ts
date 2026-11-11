import type {
  AdminProduct,
  AdminProductListItem,
  OrderProduction,
  Page,
  PricePreview,
  PrintFilesTotal,
  StaffOrder,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, cubeStl, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import {
  createStudio,
  moveOrder,
  placeOrder,
  type Studio,
  useRoundPricing,
} from './studio-helpers.js';
import { bambuThreeMf } from './three-mf-file.js';

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
 * A product shown assembled and printed from sliced files: the shop shows its model, while its
 * grams, time and colours are its print files' total (purge, prime tower and supports in
 * them), priced without purge waste on top, taken from stock per colour, and downloaded from
 * the order by the studio only.
 */
describe('Products with sliced print files (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;
  let look: string;
  let base: string;
  let shade: string;
  let never: string;

  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  const upload = (bytes: Buffer, name: string) =>
    http()
      .post('/uploads/product-model')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', bytes, name)
      .expect(201)
      .then((r) => r.body.key as string);
  const files = () => [
    { key: base, name: 'Base' },
    { key: shade, name: 'Shade' },
  ];
  const save = (extra: object) =>
    as(admin.cookie).put(`/products/${studio.product.id}`, {
      slug: studio.product.slug,
      name: studio.product.name,
      description: studio.product.description,
      materialId: studio.material.id,
      grams: '25.00',
      printHours: '3.00',
      isCustom: false,
      active: true,
      imageKeys: [],
      modelFileKey: look,
      options: [],
      sizes: [],
      colours: [
        { colour: 'Red', hex: '#aa2222', grams: '20.50' },
        { colour: 'Copper silk', hex: '#b87333', grams: '4.50' },
      ],
      printFiles: files(),
      ...extra,
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
    // The assembled look (any model), and the plates it is printed from.
    look = await upload(cubeStl(30), 'lamp_assembly.stl');
    base = await upload(
      bambuThreeMf({ sliced: true }),
      'lamp_1_base.gcode.3mf',
    );
    shade = await upload(
      bambuThreeMf({ sliced: true }),
      'lamp_2_shade.gcode.3mf',
    );
    never = await upload(bambuThreeMf({ sliced: false }), 'lamp_3_ring.3mf');
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('reads the sliced files and adds them up, with how each was set up', async () => {
    const total = (
      await as(admin.cookie)
        .post('/products/print-files', {
          files: files(),
          materialId: studio.material.id,
        })
        .expect(200)
    ).body as PrintFilesTotal;
    expect(total).toMatchObject({
      grams: '25.00',
      printHours: '3.00',
      colours: [
        { colour: 'Red', hex: '#aa2222', grams: '20.50' },
        { colour: 'Copper silk', hex: '#b87333', grams: '4.50' },
      ],
    });
    expect(total.files.map((f) => [f.name, f.grams, f.printHours])).toEqual([
      ['Base', '12.50', '1.50'],
      ['Shade', '12.50', '1.50'],
    ]);
    expect(total.files[0]!.setup).toMatchObject({
      plates: 1,
      supports: true,
      primeTower: true,
      printer: 'Bambu Lab X2D',
      nozzleMm: 0.4,
      layerHeightMm: 0.12,
    });

    const ask = (body: object) =>
      as(admin.cookie).post('/products/print-files', {
        materialId: studio.material.id,
        ...body,
      });
    // A file never sliced can't say what it takes: named in the refusal.
    const refused = await ask({
      files: [...files(), { key: never, name: 'Ring' }],
    }).expect(400);
    expect(JSON.stringify(refused.body)).toContain('Ring is not sliced');
    await ask({ files: [files()[0], files()[0]] }).expect(400);
    await ask({ files: [] }).expect(400);
    await ask({ files: [{ key: look, name: 'Look' }] }).expect(400);
    // For whoever manages the catalog only.
    const staff = await signedInAs(app, Role.STAFF);
    await as(staff.cookie)
      .post('/products/print-files', {
        files: files(),
        materialId: studio.material.id,
      })
      .expect(403);
  });

  it('prices the product from its print files, without purge waste on top', async () => {
    const own = (
      await as(admin.cookie)
        .post('/products/price-preview', {
          materialId: studio.material.id,
          grams: '25.00',
          printHours: '3.00',
          printFileKeys: [base, shade],
        })
        .expect(200)
    ).body as PricePreview;
    const typed = (
      await as(admin.cookie)
        .post('/products/price-preview', {
          materialId: studio.material.id,
          grams: '25.00',
          printHours: '3.00',
        })
        .expect(200)
    ).body as PricePreview;
    expect(own.wasteIncluded).toBe(true);
    expect(typed.wasteIncluded).toBe(false);
    expect(Number(own.calculatedPrice)).toBeLessThan(
      Number(typed.calculatedPrice),
    );

    const saved = (await save({}).expect(200)).body as AdminProduct;
    expect(saved.slicedFile).toBe(true);
    expect(saved.price).toBe(own.calculatedPrice);
    expect(saved.printFiles.map((f) => [f.name, f.fileKey, f.grams])).toEqual([
      ['Base', base, '12.50'],
      ['Shade', shade, '12.50'],
    ]);
    expect(saved.printFiles[0]!.setup.printer).toBe('Bambu Lab X2D');

    // Other numbers than the files' total: typed in, so the shop's purge waste applies.
    const edited = (
      await save({
        grams: '30.00',
        colours: [{ colour: 'Red', hex: '#aa2222', grams: '30.00' }],
      }).expect(200)
    ).body as AdminProduct;
    expect(edited.slicedFile).toBe(false);
    await save({ printFiles: [{ key: never, name: 'Ring' }] }).expect(400);
    await save({}).expect(200);
  });

  it('shows the model to shoppers and in the dashboard list, never the print files', async () => {
    const shop = await http()
      .get(`/products/${studio.product.slug}`)
      .expect(200);
    expect(shop.body.modelKey).toBe(look);
    expect(JSON.stringify(shop.body)).not.toContain(base);
    await http().get(`/media/${base}`).expect(404);
    await as(admin.cookie).get(`/media/${base}`).expect(200);

    const list = (
      await as(admin.cookie)
        .get(`/products/manage?q=${encodeURIComponent(studio.product.name)}`)
        .expect(200)
    ).body as Page<AdminProductListItem>;
    expect(list.items.find((p) => p.id === studio.product.id)).toMatchObject({
      modelKey: look,
      hasModel: true,
    });
  });

  it('an order takes each colour from stock and gives the studio its print files', async () => {
    const customer = await signedInAs(app, Role.CUSTOMER);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 2, options: [] },
      { paymentMethod: 'COD', delivery: false },
    );
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const staff = await signedInAs(app, Role.STAFF);
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const taken = await prisma.stockMovement.findMany({
      where: { orderItemId: line.id, kind: 'ORDER' },
      include: { stockItem: true },
      orderBy: { grams: 'asc' },
    });
    // Two pieces: 2 × 20.5 g red, 2 × 4.5 g copper silk.
    expect(taken.map((m) => [m.stockItem.colour, m.grams])).toEqual([
      ['Red', -41],
      ['Copper silk', -9],
    ]);

    // The order in figures: its filament by colour and time for whoever sees orders; what it
    // costs and earns only for those who see the books.
    const figures = (
      await as(staff.cookie).get(`/orders/${order.id}/production`).expect(200)
    ).body as OrderProduction;
    expect(figures).toMatchObject({
      grams: '50.0',
      printHours: '6.00',
      money: null,
      lines: [
        {
          quantity: 2,
          grams: '50.0',
          cost: null,
          colours: [
            { colour: 'Red', grams: '41.0' },
            { colour: 'Copper silk', grams: '9.0' },
          ],
        },
      ],
    });
    expect(
      [...figures.taken]
        .sort((x, y) => y.grams - x.grams)
        .map((t) => [t.colour, t.grams]),
    ).toEqual([
      ['Red', 41],
      ['Copper silk', 9],
    ]);
    const books = (
      await as(admin.cookie).get(`/orders/${order.id}/production`).expect(200)
    ).body as OrderProduction;
    expect(books.money).not.toBeNull();
    expect(
      (Number(books.money!.revenue) - Number(books.money!.cost)).toFixed(2),
    ).toBe(books.money!.profit);
    expect(books.lines[0]!.cost).toBe(books.money!.cost);
    await as(customer.cookie).get(`/orders/${order.id}/production`).expect(403);

    const view = (await as(staff.cookie).get(`/orders/${order.id}`).expect(200))
      .body as StaffOrder;
    expect(view.items[0]!.printFiles.map((f) => f.name)).toEqual([
      'Base',
      'Shade',
    ]);
    const url = `/orders/${order.id}/items/${line.id}/print-files/${view.items[0]!.printFiles[1]!.id}`;
    const file = await as(staff.cookie)
      .get(url)
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect('Content-Type', 'model/3mf');
    expect(file.headers['content-disposition']).toContain(
      `${order.orderNumber}-shade.gcode.3mf`,
    );
    expect(
      Buffer.compare(file.body as Buffer, bambuThreeMf({ sliced: true })),
    ).toBe(0);
    // Not the customer's to download, and not through another order.
    await as(customer.cookie).get(url).expect(403);
    await as(staff.cookie)
      .get(
        `/orders/${order.id}/items/${line.id}/print-files/${studio.product.id}`,
      )
      .expect(404);
  });
});
