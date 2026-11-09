import type {
  AdminProduct,
  PricePreview,
  StockItemView,
  StockOverview,
} from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import {
  createStudio,
  type Studio,
  useRoundPricing,
} from './studio-helpers.js';
import { bambuThreeMf } from './three-mf-file.js';

/**
 * A sliced 3MF's grams and time are the slicer's own: its purge, prime tower and supports are
 * in them, so the shop's purge waste isn't added again. A 3MF never sliced doesn't price a
 * quotation line. One-colour files may be recoloured too, and filament colours on the shelf
 * keep how they look (RGB).
 */
describe('Sliced 3MF prices and filament colours (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;
  let sliced: string;
  let unsliced: string;

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
  const save = (extra: object) =>
    as(admin.cookie).put(`/products/${studio.product.id}`, {
      slug: studio.product.slug,
      name: studio.product.name,
      description: studio.product.description,
      materialId: studio.material.id,
      grams: '12.50',
      printHours: '1.50',
      isCustom: false,
      active: true,
      imageKeys: [],
      modelFileKey: sliced,
      options: [],
      sizes: [],
      colours: [
        { colour: 'Red', hex: '#aa2222', grams: '10.25' },
        { colour: 'Copper silk', hex: '#b87333', grams: '2.25' },
      ],
      ...extra,
    });
  const preview = async (extra: object) =>
    (
      await as(admin.cookie)
        .post('/products/price-preview', {
          materialId: studio.material.id,
          grams: '12.50',
          printHours: '1.50',
          ...extra,
        })
        .expect(200)
    ).body as PricePreview;

  beforeAll(async () => {
    app = await createApp();
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
    const upload = (bytes: Buffer, name: string) =>
      as(admin.cookie)
        .upload('/uploads/product-model', bytes, name)
        .expect(201)
        .then((r) => r.body.key as string);
    sliced = await upload(bambuThreeMf({ sliced: true }), 'p.gcode.3mf');
    unsliced = await upload(bambuThreeMf({ sliced: false }), 'p.3mf');
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('adds no purge waste to a product priced with its sliced file’s own numbers', async () => {
    const own = await preview({ modelFileKey: sliced });
    const typed = await preview({});
    expect(own.wasteIncluded).toBe(true);
    expect(typed.wasteIncluded).toBe(false);
    expect(Number(own.calculatedPrice)).toBeLessThan(
      Number(typed.calculatedPrice),
    );
    // Other numbers than the file's, or a file never sliced: the shop's purge waste applies.
    expect(
      (await preview({ modelFileKey: sliced, grams: '20' })).wasteIncluded,
    ).toBe(false);
    expect((await preview({ modelFileKey: unsliced })).wasteIncluded).toBe(
      false,
    );

    const saved = (await save({}).expect(200)).body as AdminProduct;
    expect(saved.slicedFile).toBe(true);
    expect(saved.price).toBe(own.calculatedPrice);
    const shop = await http().get(`/products/${studio.product.slug}`);
    expect(shop.body.price).toBe(own.calculatedPrice);

    const typedIn = (await save({ grams: '13', colours: [] }).expect(200))
      .body as AdminProduct;
    expect(typedIn.slicedFile).toBe(false);
  });

  it('lets customers recolour a one-colour file, and asks a name for every colour they choose', async () => {
    const group = (await as(admin.cookie).get('/option-groups').expect(200))
      .body as { id: string; name: string }[];
    const colours = group.find((g) => g.name === studio.colourGroup)!.id;
    await save({
      colours: [{ colour: 'Red', hex: '#aa2222', grams: '12.50', part: '' }],
      partColourGroupId: colours,
    }).expect(400);
    await save({
      colours: [
        { colour: 'Red', hex: '#aa2222', grams: '12.50', part: 'Colour' },
      ],
      partColourGroupId: colours,
    }).expect(200);
    const shop = await http()
      .get(`/products/${studio.product.slug}`)
      .expect(200);
    expect(
      (shop.body.options as { name: string; recolours?: string }[]).map((o) => [
        o.name,
        o.recolours,
      ]),
    ).toEqual([['Colour', '#aa2222']]);
  });

  it('a quotation line is priced only from a sliced 3MF', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const s = as(staff.cookie);
    const upload = (bytes: Buffer, name: string) =>
      s
        .upload('/uploads/quotation-file', bytes, name)
        .expect(201)
        .then((r) => r.body.key as string);
    const never = await upload(bambuThreeMf({ sliced: false }), 'q.3mf');
    const refused = await s
      .post('/quotations/print-file', { key: never })
      .expect(400);
    expect(JSON.stringify(refused.body)).toContain('Export plate sliced file');
    const done = await upload(bambuThreeMf({ sliced: true }), 'q.gcode.3mf');
    await s.post('/quotations/print-file', { key: done }).expect(200);
  });

  it('a special filament colour keeps how it looks, from its first spools on', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const s = as(staff.cookie);
    const colour = `Galaxy ${studio.tag}`;
    const line = async (): Promise<StockItemView> =>
      ((await s.get('/stock').expect(200)).body as StockOverview).items.find(
        (i) => i.material.id === studio.material.id && i.colour === colour,
      )!;
    await s
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour,
        hex: 'purple',
        spools: 1,
        spoolGrams: 1000,
        pricePerSpool: '20.00',
        updateCost: false,
      })
      .expect(400);
    await s
      .post('/stock/receipts', {
        materialId: studio.material.id,
        colour,
        hex: '#3b2a6e',
        spools: 1,
        spoolGrams: 1000,
        pricePerSpool: '20.00',
        updateCost: false,
      })
      .expect(204);
    const added = await line();
    expect(added).toMatchObject({ hex: '#3b2a6e', swatchHex: '#3b2a6e' });

    // The owner changes how it looks on the line's page.
    await as(admin.cookie)
      .put(`/stock/items/${added.id}`, {
        lowStockGrams: 500,
        spoolGrams: 1000,
        leadTimeDays: 7,
        coverDays: 30,
        active: true,
        hex: '#4b3a7e',
      })
      .expect(204);
    expect((await line()).swatchHex).toBe('#4b3a7e');
  });
});
