import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, cubeStl, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';

/**
 * The dashboard's catalog set-up, end to end: an admin defines categories, materials and
 * options with price rules, builds a product from them with a 3D model, and the shop, the
 * cart and checkout all follow those rules.
 */
describe('Catalog (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: string;
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
  });

  // Filled in by the set-up test, used by the rest.
  const ids = {
    category: '',
    pla: '',
    petg: '',
    colour: '',
    black: '',
    silk: '',
    size: '',
    small: '',
    large: '',
    material: '',
    usePetg: '',
    name: '',
    product: '',
    slug: `desk-tag-${tag}`,
    modelKey: '',
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = (await signedInAs(app, Role.ADMIN)).cookie;
  });
  afterAll(() => app.close());

  it('an admin sets up categories, materials and options with their price rules', async () => {
    const a = as(admin);
    ids.category = (
      await a
        .post('/categories', { slug: `desk-${tag}`, name: `Desk ${tag}` })
        .expect(201)
    ).body.id;
    const pla = await prisma.material.findUniqueOrThrow({
      where: { code: 'PLA' },
    });
    ids.pla = pla.id;
    ids.petg = (
      await a
        .post('/materials', {
          code: `PETG-${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
          name: 'PETG test',
          pricePerGram: '0.09',
          densityGPerCm3: '1.27',
          gramsPerHour: '10',
          stockGrams: 2000,
          lowStockThresholdGrams: 500,
          active: true,
        })
        .expect(201)
    ).body.id;

    const colour = await a
      .post('/option-groups', { name: `Colour ${tag}`, kind: 'CHOICE' })
      .expect(201);
    ids.colour = colour.body.id;
    await a
      .post(`/option-groups/${ids.colour}/values`, {
        label: 'Black',
        swatchHex: '#111111',
      })
      .expect(201);
    const withSilk = await a
      .post(`/option-groups/${ids.colour}/values`, {
        label: 'Copper silk',
        swatchHex: '#b87333',
        extraPrice: '2.00',
      })
      .expect(201);
    [ids.black, ids.silk] = withSilk.body.values.map(
      (v: { id: string }) => v.id,
    );

    ids.size = (
      await a
        .post('/option-groups', { name: `Size ${tag}`, kind: 'CHOICE' })
        .expect(201)
    ).body.id;
    await a
      .post(`/option-groups/${ids.size}/values`, {
        label: 'Small',
        sortOrder: 1,
      })
      .expect(201);
    const sizes = await a
      .post(`/option-groups/${ids.size}/values`, {
        label: 'Large',
        sortOrder: 2,
        gramsMultiplier: '1.8',
        hoursMultiplier: '1.5',
      })
      .expect(201);
    [ids.small, ids.large] = sizes.body.values.map((v: { id: string }) => v.id);

    ids.material = (
      await a
        .post('/option-groups', { name: `Material ${tag}`, kind: 'CHOICE' })
        .expect(201)
    ).body.id;
    ids.usePetg = (
      await a
        .post(`/option-groups/${ids.material}/values`, {
          label: 'PETG',
          materialId: ids.petg,
        })
        .expect(201)
    ).body.values[0].id;

    ids.name = (
      await a
        .post('/option-groups', {
          name: `Name ${tag}`,
          kind: 'TEXT',
          maxLength: 12,
          textExtraPrice: '1.50',
        })
        .expect(201)
    ).body.id;
    // Text options have no list of values.
    await a
      .post(`/option-groups/${ids.name}/values`, { label: 'x' })
      .expect(400);
  });

  it('only admins and designers change the catalog, and every change is audit-logged', async () => {
    const staff = (await signedInAs(app, Role.STAFF)).cookie;
    const customer = (await signedInAs(app, Role.CUSTOMER)).cookie;
    for (const cookie of [staff, customer]) {
      await as(cookie)
        .post('/categories', { slug: `nope-${tag}`, name: 'Nope' })
        .expect(403);
      await as(cookie).get('/option-groups').expect(403);
    }
    // Staff read materials (the production planner), customers don't.
    await as(staff).get('/materials').expect(200);
    await as(customer).get('/materials').expect(403);
    await http().get('/materials').expect(401);
    expect(
      await prisma.auditLog.count({
        where: { action: 'option-value.create', targetId: ids.colour },
      }),
    ).toBe(2);
  });

  it('uploads a 3D model through quarantine; it stays private until a product shows it', async () => {
    const res = await http()
      .post('/uploads/product-model')
      .set(CSRF)
      .set('Cookie', admin)
      .attach('file', cubeStl(20), 'cube.stl')
      .expect(201);
    expect(res.body).toMatchObject({
      key: expect.stringMatching(/^clean\/[0-9a-f-]{36}\.stl$/),
      mimeType: 'model/stl',
      originalName: 'cube.stl',
    });
    ids.modelKey = res.body.key;

    // Not on any product yet: staff can preview it, shoppers can't see it exists.
    await http().get(`/media/${ids.modelKey}`).expect(404);
    await as(admin)
      .get(`/media/${ids.modelKey}`)
      .expect(200)
      .expect('Content-Type', 'model/stl');
    // Its compressed copies were made with it, and follow the same rules.
    const lite = ids.modelKey.replace(/\.stl$/, '.lite.glb');
    expect(existsSync(join(resolve('.uploads-test'), lite))).toBe(true);
    await http().get(`/media/${lite}`).expect(404);
    await as(admin)
      .get(`/media/${lite}`)
      .expect(200)
      .expect('Content-Type', 'model/gltf-binary');
    await as(admin)
      .get(`/media/${ids.modelKey.replace(/\.stl$/, '.huge.glb')}`)
      .expect(404);

    // Anything that isn't really a model is refused, whatever it is called.
    await http()
      .post('/uploads/product-model')
      .set(CSRF)
      .set('Cookie', admin)
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'model.stl')
      .expect(400);
    await http()
      .post('/uploads/product-image')
      .set(CSRF)
      .set('Cookie', (await signedInAs(app, Role.STAFF)).cookie)
      .attach('file', cubeStl(5), 'x.png')
      .expect(403);
  });

  const product = () => ({
    slug: ids.slug,
    name: `Desk tag ${tag}`,
    description: 'A desk name tag, printed to order.',
    categoryId: ids.category,
    materialId: ids.pla,
    grams: '60',
    printHours: '3',
    isCustom: false,
    active: true,
    modelFileKey: ids.modelKey,
    imageKeys: [],
    options: [
      {
        groupId: ids.colour,
        required: true,
        valueIds: [ids.black, ids.silk],
        defaultValueId: ids.black,
      },
      {
        groupId: ids.size,
        required: true,
        valueIds: [ids.small, ids.large],
      },
      { groupId: ids.name, required: false, valueIds: [] },
    ],
  });

  it('refuses a product set-up the shop could not sell', async () => {
    const a = as(admin);
    const p = product();
    const broken = [
      // A value from another group.
      { options: [{ ...p.options[0]!, valueIds: [ids.large] }] },
      // A default that isn't offered.
      {
        options: [
          { ...p.options[0]!, valueIds: [ids.black], defaultValueId: ids.silk },
        ],
      },
      // A choice group with no choices.
      { options: [{ ...p.options[1]!, valueIds: [] }] },
      // The same group twice.
      { options: [p.options[0]!, p.options[0]!] },
      // A file that was never uploaded.
      { modelFileKey: `clean/${randomUUID()}.stl` },
    ];
    for (const change of broken) {
      await a.post('/products', { ...p, ...change }).expect(400);
    }
    await a.post('/products', { ...p, materialId: randomUUID() }).expect(400);
  });

  it('creates the product; the shop shows its choices but never the price rules', async () => {
    const created = await as(admin).post('/products', product()).expect(201);
    ids.product = created.body.id;
    expect(created.body.options).toHaveLength(3);

    const page = await http().get(`/products/${ids.slug}`).expect(200);
    expect(page.body).toMatchObject({
      category: { slug: `desk-${tag}` },
      hasOptions: true,
      modelKey: ids.modelKey,
      previewColor: '#111111',
    });
    expect(page.body.options.map((o: { name: string }) => o.name)).toEqual([
      `Colour ${tag}`,
      `Size ${tag}`,
      `Name ${tag}`,
    ]);
    expect(JSON.stringify(page.body)).not.toMatch(
      /Multiplier|extraPrice|pricePerGram|grams|printHours/,
    );
    // Now that an active product shows it, anyone can load the model.
    await http().get(`/media/${ids.modelKey}`).expect(200);
    // A copy that is missing (a model uploaded before copies existed) is made when asked for.
    const view = ids.modelKey.replace(/\.stl$/, '.view.glb');
    rmSync(join(resolve('.uploads-test'), view));
    const copy = await http()
      .get(`/media/${view}`)
      .responseType('blob')
      .expect(200)
      .expect('Content-Type', 'model/gltf-binary')
      .expect('Cache-Control', 'public, max-age=31536000, immutable');
    expect((copy.body as Buffer).subarray(0, 4).toString()).toBe('glTF');

    const list = await http().get(`/products?category=desk-${tag}`).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([
      ids.product,
    ]);
  });

  it('prices each choice by its rule: add-ons after markup, multipliers, material switch, text', async () => {
    const price = async (options: object[]) =>
      (
        await http()
          .post(`/products/${ids.slug}/price`)
          .set(CSRF)
          .send({ options })
          .expect(200)
      ).body.unitPrice as string;
    const small = await price([{ groupId: ids.size, valueId: ids.small }]);
    const silk = await price([
      { groupId: ids.size, valueId: ids.small },
      { groupId: ids.colour, valueId: ids.silk },
    ]);
    const large = await price([{ groupId: ids.size, valueId: ids.large }]);
    const named = await price([
      { groupId: ids.size, valueId: ids.small },
      { groupId: ids.name, text: 'Rana' },
    ]);
    expect(Number(silk) - Number(small)).toBeCloseTo(2);
    expect(Number(named) - Number(small)).toBeCloseTo(1.5);
    expect(Number(large)).toBeGreaterThan(Number(small) * 1.4);

    // The shop's "from" price is the cheapest default: Black, and Small (first size).
    const page = await http().get(`/products/${ids.slug}`).expect(200);
    expect(page.body.price).toBe(small);

    // Missing, foreign or oversized choices are explained, not priced.
    await http()
      .post(`/products/${ids.slug}/price`)
      .set(CSRF)
      .send({ options: [] })
      .expect(400)
      .expect((r) => expect(r.body.message).toBe(`Choose a Size ${tag}`));
    await http()
      .post(`/products/${ids.slug}/price`)
      .set(CSRF)
      .send({
        options: [
          { groupId: ids.size, valueId: ids.small },
          { groupId: ids.material, valueId: ids.usePetg },
        ],
      })
      .expect(400);
    await http()
      .post(`/products/${ids.slug}/price`)
      .set(CSRF)
      .send({
        options: [
          { groupId: ids.size, valueId: ids.small },
          { groupId: ids.name, text: 'Much too long a name' },
        ],
      })
      .expect(400);
  });

  it('switches the material when the product offers a material option', async () => {
    const withMaterial = {
      ...product(),
      options: [
        ...product().options,
        { groupId: ids.material, required: false, valueIds: [ids.usePetg] },
      ],
    };
    await as(admin).put(`/products/${ids.product}`, withMaterial).expect(200);
    const price = async (options: object[]) =>
      (
        await http()
          .post(`/products/${ids.slug}/price`)
          .set(CSRF)
          .send({ options })
          .expect(200)
      ).body.unitPrice as string;
    const pla = await price([{ groupId: ids.size, valueId: ids.small }]);
    const petg = await price([
      { groupId: ids.size, valueId: ids.small },
      { groupId: ids.material, valueId: ids.usePetg },
    ]);
    expect(Number(petg)).toBeGreaterThan(Number(pla));
  });

  it('keeps each configuration as its own cart line and snapshots the choices on the order', async () => {
    const customer = await signedInAs(app, Role.CUSTOMER);
    const c = as(customer.cookie);
    const add = (options: object[], quantity = 1) =>
      c
        .post('/cart/items', { productId: ids.product, quantity, options })
        .expect(201);
    const silk = [
      { groupId: ids.size, valueId: ids.large },
      { groupId: ids.colour, valueId: ids.silk },
      { groupId: ids.name, text: ' Rana ' },
    ];
    await add(silk);
    await add([{ groupId: ids.size, valueId: ids.small }]);
    // The same choices in another order are the same line.
    const cart = await add([...silk].reverse(), 2);
    expect(cart.body.lines).toHaveLength(2);
    const [first, second] = cart.body.lines;
    expect(first).toMatchObject({
      quantity: 3,
      options: [
        { group: `Colour ${tag}`, value: 'Copper silk' },
        { group: `Size ${tag}`, value: 'Large' },
        { group: `Name ${tag}`, value: 'Rana' },
      ],
    });
    // The default colour is filled in when none was chosen.
    expect(second.options).toEqual([
      { group: `Colour ${tag}`, value: 'Black' },
      { group: `Size ${tag}`, value: 'Small' },
    ]);
    const quoted = await http()
      .post(`/products/${ids.slug}/price`)
      .set(CSRF)
      .send({ options: silk })
      .expect(200);
    expect(first.unitPrice).toBe(quoted.body.unitPrice);

    // An invalid choice is refused before it reaches the cart.
    await c
      .post('/cart/items', {
        productId: ids.product,
        options: [{ groupId: ids.size, valueId: ids.silk }],
      })
      .expect(400);

    const order = await c
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Rana',
        phone: '70 123 456',
        paymentMethod: 'COD',
        delivery: false,
      })
      .expect(201);
    const items = await prisma.orderItem.findMany({
      where: { order: { orderNumber: order.body.orderNumber } },
      orderBy: { lineTotal: 'desc' },
    });
    expect(items.map((i) => i.options)).toEqual([
      first.options,
      second.options,
    ]);
  });

  it('drops a cart line whose choice the admin stopped offering', async () => {
    const customer = await signedInAs(app, Role.CUSTOMER);
    const c = as(customer.cookie);
    await c
      .post('/cart/items', {
        productId: ids.product,
        options: [
          { groupId: ids.size, valueId: ids.small },
          { groupId: ids.colour, valueId: ids.silk },
        ],
      })
      .expect(201);
    await as(admin)
      .put(`/option-groups/${ids.colour}/values/${ids.silk}`, {
        label: 'Copper silk',
        extraPrice: '2.00',
        active: false,
      })
      .expect(200);
    const cart = await c.get('/cart').expect(200);
    expect(cart.body).toEqual({ lines: [], itemCount: 0 });
  });

  it('answers clearly when a name or address is already used', async () => {
    await as(admin)
      .post('/categories', { slug: `desk-${tag}`, name: 'Duplicate' })
      .expect(409);
    await as(admin)
      .put(`/categories/${randomUUID()}`, {
        slug: `other-${tag}`,
        name: 'Ghost',
      })
      .expect(404);
  });
});
