import type {
  AdminProduct,
  PricePreview,
  StockItemView,
  StockOverview,
  StockPrintable,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import {
  createStudio,
  moveOrder,
  placeOrder,
  type Studio,
  useRoundPricing,
} from './studio-helpers.js';

/**
 * Filaments as they are bought: each reel on the shelf keeps its own name, look and price. A
 * product's colour printed from a reel costs what that reel costs and comes off that reel, of
 * whatever material it is (PETG supports on a PLA piece); a colour customers choose comes off
 * the reel the owner linked it to.
 */
describe('Filament reels: own price, assigned to colours (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;
  let white: StockItemView;
  let support: StockItemView;

  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  const shelf = async () =>
    ((await as(admin.cookie).get('/stock').expect(200)).body as StockOverview)
      .items;
  const save = (colours: object[]) =>
    as(admin.cookie).put(`/products/${studio.product.id}`, {
      slug: studio.product.slug,
      name: studio.product.name,
      description: studio.product.description,
      materialId: studio.material.id,
      grams: '100',
      printHours: '5',
      isCustom: false,
      active: true,
      imageKeys: [],
      options: [],
      sizes: [],
      colours,
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
    // A second material for the supports' filament.
    const petg = await prisma.material.create({
      data: {
        code: `PETG-${studio.tag}`.toUpperCase(),
        name: `Support filament ${studio.tag}`,
        pricePerGram: '0.05',
        lowStockThresholdGrams: 500,
      },
    });
    const receive = (materialId: string, colour: string, price: string) =>
      as(admin.cookie)
        .post('/stock/receipts', {
          materialId,
          colour,
          hex: '#f2f2ee',
          spools: 1,
          spoolGrams: 1000,
          pricePerSpool: price,
          // The material's own price stays as it is: only this reel costs this.
          updateCost: false,
        })
        .expect(204);
    await receive(studio.material.id, 'Elegoo PLA Matte (White)', '17.00');
    await receive(petg.id, 'Elegoo Rapid PETG (Black)', '20.00');
    const items = await shelf();
    white = items.find(
      (i) =>
        i.material.id === studio.material.id &&
        i.colour === 'Elegoo PLA Matte (White)',
    )!;
    support = items.find((i) => i.material.id === petg.id)!;
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('a reel costs what its own spools cost, whatever its material costs', () => {
    // The material is $0.05 a gram; this reel was $17 a kilo.
    expect(white.costPerGram).toBe('0.0170');
    expect(support.costPerGram).toBe('0.0200');
  });

  it('prices a product by the reels its colours are printed from', async () => {
    const preview = async (colours?: object[]) =>
      (
        await as(admin.cookie)
          .post('/products/price-preview', {
            materialId: studio.material.id,
            grams: '100',
            printHours: '5',
            ...(colours ? { colours } : {}),
          })
          .expect(200)
      ).body as PricePreview;
    const byMaterial = await preview();
    const byReel = await preview([
      { grams: '80', stockItemId: white.id },
      { grams: '20', stockItemId: support.id },
    ]);
    // 100 g at the material's $0.05 = $5.00; from the reels 80 × 0.017 + 20 × 0.02 = $1.76.
    expect(byMaterial.breakdown!.material).toBe('5.00');
    expect(byReel.breakdown!.material).toBe('1.76');
    expect(Number(byReel.calculatedPrice)).toBeLessThan(
      Number(byMaterial.calculatedPrice),
    );

    const colours = [
      {
        colour: 'Elegoo PLA Matte (White)',
        hex: '#ffffff',
        grams: '80',
        stockItemId: white.id,
      },
      {
        colour: 'Elegoo Rapid PETG (Black)',
        hex: '#000000',
        grams: '20',
        stockItemId: support.id,
      },
    ];
    const saved = (await save(colours).expect(200)).body as AdminProduct;
    expect(saved.colours.map((c) => c.stockItemId)).toEqual([
      white.id,
      support.id,
    ]);
    expect(saved.price).toBe(byReel.calculatedPrice);
    // A filament that isn't on the shelf is refused.
    await save([{ ...colours[0], stockItemId: studio.product.id }]).expect(400);
  });

  it('an order takes each colour from its reel, the supports from their own material', async () => {
    const customer = await signedInAs(app, Role.CUSTOMER);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 2, options: [] },
      { paymentMethod: 'COD', delivery: false },
    );
    const staff = await signedInAs(app, Role.STAFF);
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const after = await shelf();
    expect(after.find((i) => i.id === white.id)!.stockGrams).toBe(1000 - 160);
    expect(after.find((i) => i.id === support.id)!.stockGrams).toBe(1000 - 40);
    // Nothing went to a line named only after a colour.
    expect(
      after.filter(
        (i) => i.material.id === studio.material.id && i.stockGrams < 0,
      ),
    ).toEqual([]);
  });

  it('printed for the studio, a piece takes each colour from its reel, as an order does', async () => {
    const before = await shelf();
    const grams = (id: string) => before.find((i) => i.id === id)!.stockGrams;
    await as(admin.cookie)
      .post('/stock/studio-prints', {
        productId: studio.product.id,
        quantity: 1,
      })
      .expect(200);
    const after = await shelf();
    expect(after.find((i) => i.id === white.id)!.stockGrams).toBe(
      grams(white.id) - 80,
    );
    expect(after.find((i) => i.id === support.id)!.stockGrams).toBe(
      grams(support.id) - 20,
    );
  });

  it('a piece whose colour customers choose is printed for the studio in the colour picked, from its reel', async () => {
    await as(admin.cookie)
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour: 'Elegoo PLA+ (Beige)',
        hex: '#e8dbb7',
        spools: 1,
        spoolGrams: 1000,
        pricePerSpool: '17.00',
        updateCost: false,
      })
      .expect(204);
    const beige = (await shelf()).find(
      (i) =>
        i.material.id === studio.material.id &&
        i.colour === 'Elegoo PLA+ (Beige)',
    )!;
    const group = await prisma.optionGroup.create({
      data: {
        name: `Stand colours ${studio.tag}`,
        values: {
          create: [
            {
              label: 'Beige',
              swatchHex: '#e8dbb7',
              stockItemId: beige.id,
              sortOrder: 1,
            },
            { label: 'Pink', swatchHex: '#e4207c', sortOrder: 2 },
          ],
        },
      },
    });
    const product = await prisma.product.update({
      where: { id: studio.product.id },
      data: {
        partColourGroupId: group.id,
        colours: {
          deleteMany: {},
          create: [
            { colour: 'Pink', hex: '#e4207c', grams: '100', part: 'Stand' },
          ],
        },
      },
    });
    const printable = (
      (await as(admin.cookie).get('/stock/printables').expect(200))
        .body as StockPrintable[]
    ).find((p) => p.id === product.id)!;
    expect(printable.colours.map((c) => c.label)).toEqual(['Beige', 'Pink']);
    // Each part gets its own colour on the form, starting as the shop starts it.
    expect(printable.parts).toEqual([{ name: 'Stand', startsAs: 'Pink' }]);
    await as(admin.cookie)
      .post('/stock/studio-prints', {
        productId: product.id,
        parts: [{ part: 'Base', colour: 'Beige' }],
        quantity: 1,
      })
      .expect(400);
    await as(admin.cookie)
      .post('/stock/studio-prints', {
        productId: product.id,
        parts: [{ part: 'Stand', colour: 'Teal' }],
        quantity: 1,
      })
      .expect(400);
    await as(admin.cookie)
      .post('/stock/studio-prints', {
        productId: product.id,
        parts: [{ part: 'Stand', colour: 'Beige' }],
        quantity: 1,
      })
      .expect(200);
    expect((await shelf()).find((i) => i.id === beige.id)!.stockGrams).toBe(
      1000 - 100,
    );

    await as(admin.cookie)
      .post('/stock/studio-prints', {
        productId: product.id,
        colour: 'Beige',
        quantity: 1,
        toShelf: true,
      })
      .expect(200);
    expect((await shelf()).find((i) => i.id === beige.id)!.stockGrams).toBe(
      1000 - 200,
    );
  });

  it('a part starts in the colour the owner picked, else the one printed from its reel, never just the first', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: studio.product.id },
      include: {
        colours: true,
        partColourGroup: { include: { values: true } },
      },
    });
    const value = (label: string) =>
      product.partColourGroup!.values.find((v) => v.label === label)!.id;
    const start = async () => {
      const shop = (await http().get(`/products/${product.slug}`).expect(200))
        .body as { options: { name: string; defaultValueId: string | null }[] };
      return shop.options.find((o) => o.name === 'Stand')!.defaultValueId;
    };
    const row = product.colours[0]!;
    const beige = product.partColourGroup!.values.find(
      (v) => v.label === 'Beige',
    )!;
    // Named after the reel it prints from, not a choice's label: its reel's choice (Beige).
    await prisma.productColour.update({
      where: { id: row.id },
      data: { colour: 'Elegoo PLA+ (Beige)', stockItemId: beige.stockItemId },
    });
    expect(await start()).toBe(value('Beige'));
    // The owner's pick wins.
    await prisma.productColour.update({
      where: { id: row.id },
      data: { startsAs: 'Pink' },
    });
    expect(await start()).toBe(value('Pink'));
  });
});
