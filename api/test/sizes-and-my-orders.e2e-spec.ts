import { randomUUID } from 'node:crypto';
import { PRODUCT_SIZE_GROUP_ID } from '@forgea/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';

/** Real product sizes, end to end; and what customers may do with their own orders. */
describe('Sizes and My orders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
  });

  let materialId: string;
  const sized = (slug: string, extra: object = {}) => ({
    slug,
    name: `Vase ${slug}`,
    description: 'A vase in real sizes.',
    materialId,
    grams: '100',
    printHours: '5',
    isCustom: false,
    active: true,
    imageKeys: [],
    options: [],
    sizeXcm: '10',
    sizeYcm: '10',
    sizeZcm: '20',
    sizes: [
      {
        label: 'Small',
        sizeXcm: '7.5',
        sizeYcm: '7.5',
        sizeZcm: '15',
        grams: '42',
        printHours: '2.1',
        isDefault: false,
      },
      {
        label: 'Standard',
        sizeXcm: '10',
        sizeYcm: '10',
        sizeZcm: '20',
        grams: '100',
        printHours: '5',
        isDefault: true,
      },
      {
        label: 'Large',
        sizeXcm: '13',
        sizeYcm: '13',
        sizeZcm: '26',
        grams: '220',
        printHours: '11',
        isDefault: false,
      },
    ],
    ...extra,
  });

  /** A customer's order of this product in this size; its number. */
  async function order(cookie: string, productId: string, sizeId: string) {
    await as(cookie)
      .post('/cart/items', {
        productId,
        quantity: 1,
        options: [{ groupId: PRODUCT_SIZE_GROUP_ID, valueId: sizeId }],
      })
      .expect(201);
    const placed = await as(cookie)
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Maya Size',
        phone: '70 222 444',
        paymentMethod: 'TRANSFER',
        delivery: true,
        city: 'Beirut',
        addressLine: 'Hamra St',
      })
      .expect(201);
    return placed.body.orderNumber as string;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    materialId = (
      await prisma.material.findUniqueOrThrow({ where: { code: 'PLA' } })
    ).id;
  });
  afterAll(() => app.close());

  it('sells real sizes: the shop shows their measurements, each prices with its own grams, the order keeps it', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const slug = `vase-${randomUUID().slice(0, 8)}`;
    const created = (
      await as(admin.cookie).post('/products', sized(slug)).expect(201)
    ).body;
    expect(created.size).toEqual({ x: '10', y: '10', z: '20' });
    expect(created.sizes.map((s: { label: string }) => s.label)).toEqual([
      'Small',
      'Standard',
      'Large',
    ]);

    const page = (await http().get(`/products/${slug}`).expect(200)).body;
    const [size] = page.options;
    expect(size).toMatchObject({
      groupId: PRODUCT_SIZE_GROUP_ID,
      name: 'Size',
      kind: 'SIZE',
      choices: [
        { label: '7.5 × 7.5 × 15 cm' },
        { label: '10 × 10 × 20 cm' },
        { label: '13 × 13 × 26 cm' },
      ],
    });
    // Several sizes: each choice carries its measurements, the page none of its own.
    expect(page.size).toBeNull();
    // The names given in the dashboard never reach the shop.
    expect(JSON.stringify(page)).not.toMatch(/Small|Standard|Large/);
    // The price rules stay server-side.
    expect(JSON.stringify(page)).not.toMatch(/grams|printHours/);

    const price = async (label: string) =>
      Number(
        (
          await http()
            .post(`/products/${slug}/price`)
            .set(CSRF)
            .send({
              options: [
                {
                  groupId: PRODUCT_SIZE_GROUP_ID,
                  valueId: size.choices.find(
                    (c: { label: string }) => c.label === label,
                  ).id,
                },
              ],
            })
            .expect(200)
        ).body.unitPrice,
      );
    const [small, standard, large] = [
      await price('7.5 × 7.5 × 15 cm'),
      await price('10 × 10 × 20 cm'),
      await price('13 × 13 × 26 cm'),
    ];
    expect(small).toBeLessThan(standard);
    expect(large).toBeGreaterThan(standard);
    // The shop's starting price is the default size's.
    expect(Number(page.price)).toBe(standard);

    const customer = await signedInAs(app, Role.CUSTOMER);
    const largeId = size.choices[2].id as string;
    const number = await order(customer.cookie, created.id, largeId);
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { orderNumber: number } },
    });
    expect(item.options).toContainEqual({
      group: 'Size',
      value: '13 × 13 × 26 cm',
    });

    // Editing the product keeps the sizes' ids (matched by name): a cart holding one still works.
    const edited = sized(slug, {
      sizes: sized(slug).sizes.map((s) =>
        s.label === 'Large' ? { ...s, grams: '230' } : s,
      ),
    });
    const after = (
      await as(admin.cookie).put(`/products/${created.id}`, edited).expect(200)
    ).body;
    expect(
      after.sizes.find((s: { label: string }) => s.label === 'Large').id,
    ).toBe(largeId);
  });

  it('refuses sizes the shop could not sell', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const slug = () => `bad-${randomUUID().slice(0, 8)}`;
    const base = sized('x');
    const twice = base.sizes.map((s) => ({ ...s, label: 'Small' }));
    await as(admin.cookie)
      .post('/products', sized(slug(), { sizes: twice }))
      .expect(400);
    const sameCm = base.sizes.map((s, i) => ({
      ...s,
      label: `S${i}`,
      sizeXcm: '5',
      sizeYcm: '5',
      sizeZcm: '5',
    }));
    await as(admin.cookie)
      .post('/products', sized(slug(), { sizes: sameCm }))
      .expect(400);
    const twoDefaults = base.sizes.map((s) => ({ ...s, isDefault: true }));
    await as(admin.cookie)
      .post('/products', sized(slug(), { sizes: twoDefaults }))
      .expect(400);
    await as(admin.cookie)
      .post('/products', sized(slug(), { sizeZcm: undefined }))
      .expect(400);
    await as(admin.cookie)
      .post(
        '/products',
        sized(slug(), { sizes: [{ ...base.sizes[0], sizeXcm: '0' }] }),
      )
      .expect(400);
  });

  it("a customer cancels their own order while it waits, never later and never someone else's", async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const slug = `cancel-${randomUUID().slice(0, 8)}`;
    const p = (
      await as(admin.cookie).post('/products', sized(slug)).expect(201)
    ).body;
    const customer = await signedInAs(app, Role.CUSTOMER);
    const number = await order(customer.cookie, p.id, p.sizes[0].id);

    const mine = (await as(customer.cookie).get('/orders/mine').expect(200))
      .body.items;
    expect(
      mine.find((o: { orderNumber: string }) => o.orderNumber === number),
    ).toMatchObject({
      canCancel: true,
      invoices: [],
    });

    const stranger = await signedInAs(app, Role.CUSTOMER);
    await as(stranger.cookie).post(`/orders/mine/${number}/cancel`).expect(404);
    await as(customer.cookie)
      .post('/orders/mine/NOT-A-NUMBER/cancel')
      .expect(404);

    await as(customer.cookie).post(`/orders/mine/${number}/cancel`).expect(200);
    const cancelled = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: number },
      include: { statusHistory: { orderBy: { changedAt: 'desc' }, take: 1 } },
    });
    expect(cancelled.status).toBe('CANCELLED');
    // The change is in the history, with who made it.
    expect(cancelled.statusHistory[0]).toMatchObject({
      status: 'CANCELLED',
      changedByUserId: customer.user.id,
      note: 'Cancelled by the customer',
    });
    await as(customer.cookie).post(`/orders/mine/${number}/cancel`).expect(409);

    // Once the studio confirms it, only the studio can change it.
    const later = await order(customer.cookie, p.id, p.sizes[0].id);
    const row = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: later },
    });
    await http()
      .patch(`/orders/${row.id}/status`)
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .send({ status: 'CONFIRMED' })
      .expect(200);
    await as(customer.cookie).post(`/orders/mine/${later}/cancel`).expect(409);
  });

  it('"Order again" puts the same products, sizes and options back in the cart; gone ones are named', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const slug = `again-${randomUUID().slice(0, 8)}`;
    const p = (
      await as(admin.cookie).post('/products', sized(slug)).expect(201)
    ).body;
    const customer = await signedInAs(app, Role.CUSTOMER);
    const large = p.sizes.find((s: { label: string }) => s.label === 'Large')
      .id as string;
    const number = await order(customer.cookie, p.id, large);

    const again = (
      await as(customer.cookie)
        .post(`/orders/mine/${number}/reorder`)
        .expect(200)
    ).body;
    expect(again).toEqual({ added: 1, skipped: [] });
    const cart = (await as(customer.cookie).get('/cart').expect(200)).body;
    expect(JSON.stringify(cart)).toContain('13 × 13 × 26 cm');
    // The size names are the owner's: customers never see them.
    expect(JSON.stringify(cart)).not.toContain('Large');

    // The product leaves the shop: nothing is guessed, the line is named as skipped.
    await as(admin.cookie)
      .put(`/products/${p.id}`, { ...sized(slug), active: false })
      .expect(200);
    const gone = (
      await as(customer.cookie)
        .post(`/orders/mine/${number}/reorder`)
        .expect(200)
    ).body;
    expect(gone.added).toBe(0);
    expect(gone.skipped[0]).toMatch(/no longer sold/);

    await as((await signedInAs(app, Role.CUSTOMER)).cookie)
      .post(`/orders/mine/${number}/reorder`)
      .expect(404);
  });
});
