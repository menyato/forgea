import type { AdminProduct, MaterialView, PricePreview } from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import {
  createStudio,
  pricingForm,
  type PricingSettingsBody,
  ROUND_PRICING,
  type Studio,
  useRoundPricing,
} from './studio-helpers.js';

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
  ...(p.profit
    ? { profitKind: p.profit.kind, profitValue: p.profit.value }
    : {}),
  ...extra,
});

/**
 * Pricing the owner sets up once: a reel's price and weight give the cost of a gram, the
 * printer's details give the cost of an hour, and a profit rule (a percentage or a fixed
 * amount) applies to the shop or to one product.
 */
describe('Easy pricing (e2e)', () => {
  let app: NestExpressApplication;
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

  beforeAll(async () => {
    app = await createApp();
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  const shopPrice = async () =>
    (await http().get(`/products/${studio.product.slug}`).expect(200)).body
      .price as string;

  it("works out a gram's cost from the reel; without a reel the price per gram is typed", async () => {
    const code = `R${randomUUID().slice(0, 6).toUpperCase()}`;
    const material = {
      code,
      name: `Reel test ${code}`,
      reelPrice: '22.00',
      reelGrams: 1000,
      densityGPerCm3: '1.24',
      gramsPerHour: '12',
      stockGrams: 0,
      lowStockThresholdGrams: 1000,
    };
    const created = (
      await as(admin.cookie).post('/materials', material).expect(201)
    ).body as MaterialView;
    expect(created).toMatchObject({
      pricePerGram: '0.022',
      reelPrice: '22',
      reelGrams: 1000,
    });
    // A 750 g reel at $19.99: $0.0267 a gram.
    const updated = (
      await as(admin.cookie)
        .put(`/materials/${created.id}`, {
          ...material,
          reelPrice: '19.99',
          reelGrams: 750,
        })
        .expect(200)
    ).body as MaterialView;
    expect(updated.pricePerGram).toBe('0.0267');
    // A catalog file may give only the price per gram.
    const typed = (
      await as(admin.cookie)
        .put(`/materials/${created.id}`, {
          ...material,
          reelPrice: undefined,
          reelGrams: undefined,
          pricePerGram: '0.03',
        })
        .expect(200)
    ).body as MaterialView;
    expect(typed).toMatchObject({
      pricePerGram: '0.03',
      reelPrice: null,
      reelGrams: null,
    });
    // Neither: refused.
    await as(admin.cookie)
      .put(`/materials/${created.id}`, {
        ...material,
        reelPrice: undefined,
        reelGrams: undefined,
      })
      .expect(400);
  });

  it("works out an hour's cost from the printer; all four details or none", async () => {
    const settings = async () =>
      (await as(admin.cookie).get('/pricing/settings').expect(200))
        .body as PricingSettingsBody;
    const base = pricingForm(await settings());
    await as(admin.cookie)
      .put('/pricing/settings', {
        ...base,
        printerPrice: '600',
        printerLifeHours: 6000,
        printerWatts: 150,
        electricityPerKwh: '0.30',
      })
      .expect(200);
    const after = await settings();
    // $600 / 6000 h + 0.15 kWh × $0.30 = $0.145 → $0.15 an hour.
    expect(after.cost['machineRatePerHour']).toBe('0.15');
    expect(after.printer).toEqual({
      printerPrice: '600',
      lifeHours: 6000,
      watts: 150,
      electricityPerKwh: '0.3',
    });
    await as(admin.cookie)
      .put('/pricing/settings', { ...base, printerPrice: '600' })
      .expect(400);
    // Cleared: the hourly cost is typed again.
    await as(admin.cookie).put('/pricing/settings', ROUND_PRICING).expect(200);
    expect((await settings()).printer).toBeNull();
  });

  it('a profit is a percentage of the cost or a fixed amount; a product may have its own', async () => {
    // Cost $13.00 (studio-helpers); the shop's 100%: $26.00.
    expect(await shopPrice()).toBe('26.00');
    await as(admin.cookie)
      .put('/pricing/settings', {
        ...ROUND_PRICING,
        profitKind: 'FIXED',
        profitValue: '4',
      })
      .expect(200);
    expect(await shopPrice()).toBe('17.00');
    await as(admin.cookie).put('/pricing/settings', ROUND_PRICING).expect(200);

    // Its own rule: 50% → $19.50, whatever the shop's.
    const product = (
      await as(admin.cookie)
        .get(`/products/manage/${studio.product.id}`)
        .expect(200)
    ).body as AdminProduct;
    expect(product.profit).toBeNull();
    const saved = (
      await as(admin.cookie)
        .put(
          `/products/${product.id}`,
          asDto(product, { profitKind: 'PERCENT', profitValue: '50' }),
        )
        .expect(200)
    ).body as AdminProduct;
    expect(saved.profit).toEqual({ kind: 'PERCENT', value: '50' });
    expect(await shopPrice()).toBe('19.50');
    await as(admin.cookie)
      .put(
        `/products/${product.id}`,
        asDto(product, { profitKind: 'PERCENT', profitValue: '1001' }),
      )
      .expect(400);
  });

  it("only whoever manages pricing changes a product's profit or sees its costs", async () => {
    const designer = await signedInAs(app, Role.DESIGNER);
    const product = (
      await as(admin.cookie)
        .get(`/products/manage/${studio.product.id}`)
        .expect(200)
    ).body as AdminProduct;
    // A designer edits the product: its profit rule stays as it is…
    await as(designer.cookie)
      .put(`/products/${product.id}`, asDto(product, { name: 'Vase renamed' }))
      .expect(200);
    // …and may not change it, or drop it.
    await as(designer.cookie)
      .put(
        `/products/${product.id}`,
        asDto(product, { profitKind: 'FIXED', profitValue: '1' }),
      )
      .expect(403);
    const { profitKind: _k, profitValue: _v, ...withoutRule } = asDto(product);
    if (product.profit) {
      await as(designer.cookie)
        .put(`/products/${product.id}`, withoutRule)
        .expect(403);
    }

    const ask = {
      materialId: studio.material.id,
      grams: '100',
      printHours: '5',
    };
    const forAdmin = (
      await as(admin.cookie).post('/products/price-preview', ask).expect(200)
    ).body as PricePreview;
    expect(forAdmin).toEqual({
      unitPrice: '26.00',
      calculatedPrice: '26.00',
      wasteIncluded: false,
      breakdown: {
        material: '5.00',
        printer: '5.00',
        // The hourly cost was typed in (round pricing): no wear and electricity split.
        printerWear: null,
        electricity: null,
        wasteAndFailures: '2.00',
        labour: '0.50',
        packaging: '0.50',
        cost: '13.00',
        profit: '13.00',
        profitRule: { kind: 'PERCENT', value: '100' },
      },
    });
    const forDesigner = (
      await as(designer.cookie)
        .post('/products/price-preview', {
          ...ask,
          profitKind: 'FIXED',
          profitValue: '2',
        })
        .expect(200)
    ).body as PricePreview;
    expect(forDesigner).toEqual({
      unitPrice: '15.00',
      calculatedPrice: '15.00',
      wasteIncluded: false,
      breakdown: null,
    });
    const customer = await signedInAs(app, Role.CUSTOMER);
    await as(customer.cookie).post('/products/price-preview', ask).expect(403);
  });
});
