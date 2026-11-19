import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AdminProduct,
  CartView,
  FontView,
  LogoView,
  ProductDetail,
  StaffOrder,
} from '@forgea/types';
import request from 'supertest';
import { cube } from '../prisma/example-models.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs, signedInCustomer } from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { zipEntries } from '../src/uploads/zip-reader.js';

const fontFile = (file: string) =>
  readFileSync(new URL(`../prisma/example-fonts/${file}`, import.meta.url));

/** A badge: a square with a square hole (a logo is any SVG drawing). */
const BADGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/></svg>';

/**
 * Text and logos on any product: the studio's logos read from SVG, a product's slots checked
 * when saved, the shop pricing a customer's name and logo choice, the cart and the order
 * keeping them, and the studio downloading the model with them in place as one 3MF.
 */
describe('Text and logo slots (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  const tag = randomUUID().slice(0, 8);
  let font: FontView;
  let logo: LogoView;
  let white: string;
  let black: string;
  let groupId: string;
  let product: AdminProduct;

  const slots = () => [
    {
      id: 'name',
      kind: 'TEXT',
      label: 'Name',
      editable: true,
      placement: { origin: [20, 0, 20], normal: [0, -1, 0], up: [0, 0, 1] },
      heightMm: 8,
      maxWidthMm: 36,
      depthMm: 1,
      colour: white,
      defaultText: 'Forgea',
      maxChars: 12,
      defaultFontId: font.id,
    },
    {
      id: 'badge',
      kind: 'LOGO',
      label: 'Logo',
      editable: true,
      placement: { origin: [20, 20, 40], normal: [0, 0, 1], up: [0, 1, 0] },
      heightMm: 20,
      maxWidthMm: 20,
      depthMm: 1,
      colour: black,
      logoId: logo.id,
      defaultOn: true,
    },
  ];
  const price = async (choices: object[]) =>
    Number(
      (
        await http()
          .post(`/products/${product.slug}/price`)
          .set(CSRF)
          .send({ options: [], slots: choices })
          .expect(200)
      ).body.unitPrice,
    );

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    const uploadedFont = await http()
      .post('/uploads/font')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', fontFile('Cairo.ttf'), 'Cairo.ttf')
      .expect(201);
    font = (
      await as(admin.cookie)
        .post('/fonts', {
          fileKey: uploadedFont.body.key,
          name: `Cairo ${tag}`,
        })
        .expect(201)
    ).body as FontView;
    const group = await prisma.optionGroup.create({
      data: {
        name: `Slot colours ${tag}`,
        values: {
          create: [
            { label: 'White', swatchHex: '#f2f2ee', sortOrder: 0 },
            { label: 'Black', swatchHex: '#161616', sortOrder: 1 },
          ],
        },
      },
      include: { values: { orderBy: { sortOrder: 'asc' } } },
    });
    groupId = group.id;
    [white, black] = group.values.map((v) => v.id) as [string, string];
  });
  afterAll(() => app.close());

  it('reads a logo from an SVG drawing into print outlines, for the team only', async () => {
    const created = await http()
      .post('/logos')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .field('name', `Badge ${tag}`)
      .attach('file', Buffer.from(BADGE), 'badge.svg')
      .expect(201);
    logo = created.body as LogoView;
    expect(logo).toMatchObject({ name: `Badge ${tag}`, active: true });
    expect(logo.points).toBeGreaterThanOrEqual(8);
    await http()
      .post('/logos')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .field('name', `Not a logo ${tag}`)
      .attach('file', Buffer.from('hello'), 'x.svg')
      .expect(400);
    const customer = await signedInCustomer(app);
    await as(customer.cookie).get('/logos').expect(403);
    const list = (await as(admin.cookie).get('/logos').expect(200))
      .body as LogoView[];
    expect(list.map((l) => l.id)).toContain(logo.id);
  });

  it('a product takes text and logo slots, checked when it is saved', async () => {
    const model = await http()
      .post('/uploads/product-model')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', Buffer.from(cube(40)), 'cube.stl')
      .expect(201);
    const pla = await prisma.material.findUniqueOrThrow({
      where: { code: 'PLA' },
    });
    const dto = {
      slug: `slot-cube-${tag}`,
      name: `Slot cube ${tag}`,
      description: 'A cube with a name and a logo.',
      materialId: pla.id,
      grams: '40',
      printHours: '2',
      isCustom: false,
      active: true,
      imageKeys: [],
      options: [],
      sizes: [],
      modelFileKey: model.body.key,
      partColourGroupId: groupId,
      slots: slots(),
    };
    // A colour that isn't one of the product's is refused, and so is an unknown font.
    await as(admin.cookie)
      .post('/products', {
        ...dto,
        slots: [{ ...slots()[0], colour: randomUUID() }],
      })
      .expect(400);
    await as(admin.cookie)
      .post('/products', {
        ...dto,
        slots: [{ ...slots()[0], defaultFontId: randomUUID() }],
      })
      .expect(400);
    product = (await as(admin.cookie).post('/products', dto).expect(201))
      .body as AdminProduct;
    expect(product.slots.map((s) => s.id)).toEqual(['name', 'badge']);

    const page = (await http().get(`/products/${product.slug}`).expect(200))
      .body as ProductDetail;
    expect(page.slots?.slots).toHaveLength(2);
    expect(page.slots?.logos[0]?.id).toBe(logo.id);
    expect(page.slots?.logos[0]?.outline.length).toBeGreaterThan(0);
    expect(page.slots?.fonts.map((f) => f.id)).toContain(font.id);
    expect(page.slots?.colours.map((c) => c.label)).toEqual(['White', 'Black']);
  });

  it('the shop prices what is printed: a shorter name costs less, so does no logo', async () => {
    const standard = await price([]);
    const shorter = await price([{ slotId: 'name', text: 'Al' }]);
    const noLogo = await price([{ slotId: 'badge', on: false }]);
    expect(shorter).toBeLessThan(standard);
    expect(noLogo).toBeLessThan(standard);
    // Too long, a font not offered, a colour not offered: refused with the reason.
    const refused = await http()
      .post(`/products/${product.slug}/price`)
      .set(CSRF)
      .send({ options: [], slots: [{ slotId: 'name', text: 'x'.repeat(13) }] })
      .expect(400);
    expect(refused.body.message).toMatch(/Name: At most 12/);
    await http()
      .post(`/products/${product.slug}/price`)
      .set(CSRF)
      .send({ options: [], slots: [{ slotId: 'name', fontId: randomUUID() }] })
      .expect(400);
    await http()
      .post(`/products/${product.slug}/price`)
      .set(CSRF)
      .send({ options: [], slots: [{ slotId: 'name', colour: randomUUID() }] })
      .expect(400);
  });

  it('the cart and the order keep the name, and the studio downloads the model with it in place', async () => {
    const customer = await signedInCustomer(app);
    const cart = (
      await as(customer.cookie)
        .post('/cart/items', {
          productId: product.id,
          quantity: 1,
          options: [],
          slots: [
            { slotId: 'name', text: 'Sara' },
            { slotId: 'badge', colour: white },
          ],
        })
        .expect(201)
    ).body as CartView;
    const line = cart.lines.find((l) => l.productId === product.id)!;
    expect(
      line.slots.map((s) => [s.label, s.text ?? s.logo, s.colour]),
    ).toEqual([
      ['Name', 'Sara', 'White'],
      ['Logo', `Badge ${tag}`, 'White'],
    ]);
    const placed = await as(customer.cookie)
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Sara Haddad',
        phone: '70 123 456',
        paymentMethod: 'COD',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
      include: { items: true },
    });
    const staff = (
      await as(admin.cookie).get(`/orders/${order.id}`).expect(200)
    ).body as StaffOrder;
    expect(staff.items[0]!.slots.map((s) => s.text ?? s.logo)).toEqual([
      'Sara',
      `Badge ${tag}`,
    ]);
    const file = await as(admin.cookie)
      .get(`/orders/${order.id}/items/${order.items[0]!.id}/slots-project`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const bytes = file.body as Buffer;
    // A 3MF (a zip) holding the model and both slots as named parts.
    const model = zipEntries(new Uint8Array(bytes), {
      maxEntries: 20,
      maxEntryBytes: 50 * 1024 * 1024,
      maxTotalBytes: 50 * 1024 * 1024,
    })
      .find((e) => e.name === '3D/3dmodel.model')!
      .read()
      .toString('utf8');
    expect(model).toContain('name="Model"');
    expect(model).toContain('name="Name: Sara (White)"');
    expect(model).toContain(`name="Logo: Badge ${tag} (White)"`);
  });

  it('a name keychain takes a shape and a logo among the ones its product offers', async () => {
    const pla = await prisma.material.findUniqueOrThrow({
      where: { code: 'PLA' },
    });
    const keychain = (
      await as(admin.cookie)
        .post('/products', {
          slug: `shaped-keychain-${tag}`,
          name: `Shaped keychain ${tag}`,
          description: 'A name keychain in a shape, with a logo.',
          materialId: pla.id,
          grams: '8',
          printHours: '0.5',
          isCustom: false,
          active: true,
          imageKeys: [],
          options: [],
          sizes: [],
          text: {
            style: 'KEYCHAIN',
            maxChars: 12,
            letterHeightMm: '10',
            letterDepthMm: '1.6',
            baseDepthMm: '2.4',
            maxWidthMm: '90',
            colourGroupId: groupId,
            extraColourPrice: '1.00',
            sizesMm: [],
            shapes: ['HEART', 'OVAL'],
            logoIds: [logo.id],
          },
        })
        .expect(201)
    ).body as AdminProduct;
    expect(keychain.text).toMatchObject({
      shapes: ['HEART', 'OVAL'],
      logoIds: [logo.id],
    });
    const page = (await http().get(`/products/${keychain.slug}`).expect(200))
      .body as ProductDetail;
    expect(page.text?.shapes).toEqual(['HEART', 'OVAL']);
    expect(page.text?.logos.map((l) => l.id)).toEqual([logo.id]);

    const design = {
      text: 'Sara',
      fontId: font.id,
      textColour: white,
      baseColour: black,
    };
    const priced = async (extra: object) =>
      Number(
        (
          await http()
            .post(`/products/${keychain.slug}/price`)
            .set(CSRF)
            .send({ options: [], design: { ...design, ...extra } })
            .expect(200)
        ).body.unitPrice,
      );
    const plain = await priced({});
    // A heart round the name, and a logo beside it, take more filament.
    expect(await priced({ shape: 'HEART' })).toBeGreaterThan(plain);
    expect(await priced({ logoId: logo.id })).toBeGreaterThan(plain);
    // A shape or logo the product doesn't offer is refused.
    await http()
      .post(`/products/${keychain.slug}/price`)
      .set(CSRF)
      .send({ options: [], design: { ...design, shape: 'ROUNDED' } })
      .expect(400);
    await http()
      .post(`/products/${keychain.slug}/price`)
      .set(CSRF)
      .send({ options: [], design: { ...design, logoId: randomUUID() } })
      .expect(400);
    // The cart says how it is made.
    const customer = await signedInCustomer(app);
    const cart = (
      await as(customer.cookie)
        .post('/cart/items', {
          productId: keychain.id,
          quantity: 1,
          options: [],
          design: { ...design, shape: 'HEART', logoId: logo.id },
        })
        .expect(201)
    ).body as CartView;
    expect(
      cart.lines.find((l) => l.productId === keychain.id)!.design,
    ).toMatchObject({ text: 'Sara', shape: 'Heart', logo: `Badge ${tag}` });
  });
});
