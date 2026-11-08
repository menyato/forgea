import type {
  AdminProduct,
  ModelFileInfo,
  PricePreview,
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

/** A product as the dashboard saves it back (PUT /products/:id). */
const asDto = (p: AdminProduct, extra: object = {}) => ({
  slug: p.slug,
  name: p.name,
  description: p.description,
  ...(p.categoryId ? { categoryId: p.categoryId } : {}),
  materialId: p.materialId,
  grams: p.grams,
  printHours: p.printHours,
  isCustom: p.isCustom,
  active: p.active,
  imageKeys: p.imageKeys,
  ...(p.modelFileKey ? { modelFileKey: p.modelFileKey } : {}),
  options: p.options.map((o) => ({
    groupId: o.groupId,
    required: o.required,
    valueIds: o.valueIds,
    ...(o.defaultValueId ? { defaultValueId: o.defaultValueId } : {}),
  })),
  sizes: p.sizes.map((s) => ({
    label: s.label,
    sizeXcm: s.size.x,
    sizeYcm: s.size.y,
    sizeZcm: s.size.z,
    grams: s.grams,
    printHours: s.printHours,
    isDefault: s.isDefault,
  })),
  colours: p.colours,
  ...(p.priceOverride ? { priceOverride: p.priceOverride } : {}),
  ...extra,
});

/**
 * Products from a Bambu Studio 3MF: uploaded through quarantine, read in the 3D worker (its
 * colours, and the slicer's grams and time when sliced), shown in its own colours while the
 * file itself stays the studio's, its grams per colour taken from stock, and its print project
 * downloadable from the order. And the owner's own price beside the calculated one.
 */
describe('3MF products and own prices (e2e)', () => {
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
  let studio: Studio;
  let slicedKey: string;
  let projectKey: string;

  const upload = (cookie: string, bytes: Buffer, name: string) =>
    http()
      .post('/uploads/product-model')
      .set(CSRF)
      .set('Cookie', cookie)
      .attach('file', bytes, name);
  const manage = async () =>
    (await as(admin.cookie).get(`/products/manage/${studio.product.id}`))
      .body as AdminProduct;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('accepts a 3MF through quarantine; the file stays the studio’s, its copies follow the product', async () => {
    const res = await upload(
      admin.cookie,
      bambuThreeMf({ sliced: true }),
      'piece.gcode.3mf',
    ).expect(201);
    expect(res.body).toMatchObject({
      key: expect.stringMatching(/^clean\/[0-9a-f-]{36}\.3mf$/),
      mimeType: 'model/3mf',
    });
    slicedKey = res.body.key;
    projectKey = (
      await upload(
        admin.cookie,
        bambuThreeMf({ sliced: false }),
        'piece.3mf',
      ).expect(201)
    ).body.key;

    // A zip that isn't a 3MF, whatever it is called, is refused.
    await upload(admin.cookie, cubeStl(5), 'x.3mf').expect(201); // an STL is still a model
    await upload(
      admin.cookie,
      Buffer.from('PK\u0003\u0004 nope'),
      'x.3mf',
    ).expect(400);

    // Not on a product yet: staff only.
    await http().get(`/media/${slicedKey}`).expect(404);
    await as(admin.cookie)
      .get(`/media/${slicedKey}`)
      .expect(200)
      .expect('Content-Type', 'model/3mf');
    const lite = slicedKey.replace(/\.3mf$/, '.lite.glb');
    const glb = (
      await as(admin.cookie)
        .get(`/media/${lite}`)
        .buffer(true)
        .parse(binary)
        .expect(200)
        .expect('Content-Type', 'model/gltf-binary')
    ).body as Buffer;
    // The copy carries the file's two filament colours as materials.
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'),
    ) as { materials?: unknown[] };
    expect(json.materials).toHaveLength(2);
  });

  it('reads a sliced file’s grams and time from the slicer, matching its colours to the shop’s', async () => {
    const info = (
      await as(admin.cookie)
        .post('/products/model-info', {
          key: slicedKey,
          materialId: studio.material.id,
        })
        .expect(200)
    ).body as ModelFileInfo;
    expect(info).toEqual({
      size: { x: '3.0', y: '2.0', z: '2.0' },
      sliced: true,
      grams: '12.50',
      printHours: '1.50',
      colours: [
        { hex: '#aa2222', type: 'PLA', grams: '10.25', suggested: 'Red' },
        {
          hex: '#b87333',
          type: 'PLA',
          grams: '2.25',
          suggested: 'Copper silk',
        },
      ],
    });
  });

  it('estimates a file never sliced from its volume, in the material and solidity chosen', async () => {
    const info = (
      await as(admin.cookie)
        .post('/products/model-info', {
          key: projectKey,
          materialId: studio.material.id,
          solidityPercent: 50,
        })
        .expect(200)
    ).body as ModelFileInfo;
    // 9 cm³ × 1.24 g/cm³ × 50% = 5.58 g, split 8:1 by volume.
    expect(info.sliced).toBe(false);
    expect(Number(info.grams)).toBeCloseTo(5.6, 1);
    expect(info.colours.map((c) => c.suggested)).toEqual([
      'Red',
      'Copper silk',
    ]);
    expect(Number(info.colours[0]!.grams)).toBeGreaterThan(
      Number(info.colours[1]!.grams) * 6,
    );
  });

  it('reads only 3MF files, only for whoever manages the catalog', async () => {
    const stl = (await upload(admin.cookie, cubeStl(10), 'c.stl').expect(201))
      .body.key as string;
    await as(admin.cookie)
      .post('/products/model-info', {
        key: stl,
        materialId: studio.material.id,
      })
      .expect(400);
    // A key that was never uploaded.
    await as(admin.cookie)
      .post('/products/model-info', {
        key: 'clean/00000000-0000-4000-8000-000000000000.3mf',
        materialId: studio.material.id,
      })
      .expect(400);
    const staff = await signedInAs(app, Role.STAFF);
    await as(staff.cookie)
      .post('/products/model-info', {
        key: slicedKey,
        materialId: studio.material.id,
      })
      .expect(403);
    await http()
      .post('/products/model-info')
      .set(CSRF)
      .send({ key: slicedKey, materialId: studio.material.id })
      .expect(401);
  });

  it('saves a product’s colours; they must add up to its grams', async () => {
    const p = await manage();
    const colours = [
      { colour: 'Red', hex: '#aa2222', grams: '80' },
      { colour: 'Copper silk', hex: '#b87333', grams: '20' },
    ];
    await as(admin.cookie)
      .put(
        `/products/${p.id}`,
        asDto(p, { colours: [{ ...colours[0], grams: '50' }, colours[1]] }),
      )
      .expect(400);
    await as(admin.cookie)
      .put(
        `/products/${p.id}`,
        asDto(p, { colours: [colours[0], { ...colours[0], grams: '20' }] }),
      )
      .expect(400);
    await as(admin.cookie)
      .put(
        `/products/${p.id}`,
        asDto(p, { colours: [{ ...colours[0], hex: 'red' }, colours[1]] }),
      )
      .expect(400);
    const saved = (
      await as(admin.cookie)
        .put(
          `/products/${p.id}`,
          asDto(p, { colours, modelFileKey: slicedKey }),
        )
        .expect(200)
    ).body as AdminProduct;
    expect(saved.colours).toEqual(colours.map((c) => ({ ...c, part: null })));
    expect(saved.modelFileKey).toBe(slicedKey);

    // On a product in the shop: shoppers get its coloured copies, never the 3MF itself.
    await http().get(`/media/${slicedKey}`).expect(404);
    await http()
      .get(`/media/${slicedKey.replace(/\.3mf$/, '.view.glb')}`)
      .expect(200);
  });

  it('sells at the owner’s own price; sizes and options still add what they change', async () => {
    const shopPrice = async (options?: object[]) =>
      options
        ? ((
            await http()
              .post(`/products/${studio.product.slug}/price`)
              .set(CSRF)
              .send({ options })
              .expect(200)
          ).body.unitPrice as string)
        : ((await http().get(`/products/${studio.product.slug}`).expect(200))
            .body.price as string);
    const calculated = {
      standard: await shopPrice(studio.options('standard', 'red')),
      wide: await shopPrice(studio.options('standard', 'red').slice(0, 0)),
      wideRed: await shopPrice(studio.options('wide', 'red')),
      silk: await shopPrice(studio.options('standard', 'silk')),
    };

    const p = await manage();
    const preview = (
      await as(admin.cookie)
        .post('/products/price-preview', {
          materialId: p.materialId,
          grams: p.grams,
          printHours: p.printHours,
          priceOverride: '30',
        })
        .expect(200)
    ).body as PricePreview;
    expect(preview.unitPrice).toBe('30.00');
    expect(preview.calculatedPrice).toBe(calculated.standard);
    expect(preview.breakdown).not.toBeNull();

    await as(admin.cookie)
      .put(`/products/${p.id}`, asDto(p, { priceOverride: '0' }))
      .expect(400);
    const saved = (
      await as(admin.cookie)
        .put(`/products/${p.id}`, asDto(p, { priceOverride: '30' }))
        .expect(200)
    ).body as AdminProduct;
    expect(saved.priceOverride).toBe('30.00');

    expect(await shopPrice()).toBe('30.00');
    expect(await shopPrice(studio.options('standard', 'red'))).toBe('30.00');
    const plus = (a: string, b: string, c: string) =>
      (Number(a) + Number(b) - Number(c)).toFixed(2);
    expect(await shopPrice(studio.options('wide', 'red'))).toBe(
      plus('30', calculated.wideRed, calculated.standard),
    );
    expect(await shopPrice(studio.options('standard', 'silk'))).toBe(
      plus('30', calculated.silk, calculated.standard),
    );
    expect(calculated.wide).toBeDefined();

    // Back to the calculated price.
    const cleared = (
      await as(admin.cookie)
        .put(`/products/${p.id}`, asDto(saved, { priceOverride: undefined }))
        .expect(200)
    ).body as AdminProduct;
    expect(cleared.priceOverride).toBeNull();
    expect(await shopPrice()).toBe(calculated.standard);
    // Set again for the order below.
    await as(admin.cookie)
      .put(`/products/${p.id}`, asDto(cleared, { priceOverride: '30' }))
      .expect(200);
  });

  it('only whoever manages pricing sets or changes an own price; others keep it as it is', async () => {
    const designer = await signedInAs(app, Role.DESIGNER);
    const p = await manage();
    expect(p.priceOverride).toBe('30.00');
    await as(designer.cookie)
      .put(`/products/${p.id}`, asDto(p, { priceOverride: '10' }))
      .expect(403);
    await as(designer.cookie)
      .put(`/products/${p.id}`, asDto(p, { priceOverride: undefined }))
      .expect(403);
    await as(designer.cookie).put(`/products/${p.id}`, asDto(p)).expect(200);
    await as(designer.cookie)
      .post('/products', {
        ...asDto(p, { priceOverride: '10' }),
        slug: `${p.slug}-d`,
      })
      .expect(403);
    // The preview shows a designer the price, never the costs.
    const preview = (
      await as(designer.cookie)
        .post('/products/price-preview', {
          materialId: p.materialId,
          grams: p.grams,
          printHours: p.printHours,
          priceOverride: '30',
        })
        .expect(200)
    ).body as PricePreview;
    expect(preview.breakdown).toBeNull();
  });

  it('orders take each colour’s grams from its stock, and staff download the print project', async () => {
    const customer = await signedInAs(app, Role.CUSTOMER);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'wide', colour: 'red', quantity: 2 },
      { paymentMethod: 'COD', delivery: false },
    );
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    // The customer paid the owner's price plus what the wide size adds.
    expect(Number(line.unitPrice)).toBeGreaterThan(30);

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
    // The wide size takes 200 g a piece, shared 80:20 by colour, for 2 pieces.
    expect(taken.map((m) => [m.stockItem.colour, m.grams])).toEqual([
      ['Red', -320],
      ['Copper silk', -80],
    ]);

    const view = (await as(staff.cookie).get(`/orders/${order.id}`).expect(200))
      .body as StaffOrder;
    expect(view.items[0]!.printProject).toBe(true);
    const file = await as(staff.cookie)
      .get(`/orders/${order.id}/items/${line.id}/project`)
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect('Content-Type', 'model/3mf');
    expect(file.headers['content-disposition']).toContain(
      `${order.orderNumber}-${studio.product.slug}.3mf`,
    );
    expect(
      Buffer.compare(file.body as Buffer, bambuThreeMf({ sliced: true })),
    ).toBe(0);
    await as(customer.cookie)
      .get(`/orders/${order.id}/items/${line.id}/project`)
      .expect(403);
  });

  it('a catalog file carries the colours and the own price', async () => {
    const file = (
      await as(admin.cookie).get('/catalog-transfer/export').expect(200)
    ).body as {
      products: { slug: string; priceOverride?: string; colours?: unknown[] }[];
    };
    const mine = file.products.find((p) => p.slug === studio.product.slug)!;
    expect(mine.priceOverride).toBe('30.00');
    expect(mine.colours).toHaveLength(2);
  });
});
