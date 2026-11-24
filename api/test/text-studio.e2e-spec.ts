import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  type CartView,
  type FontView,
  HTTP,
  type ProductDetail,
  type StaffOrder,
} from '@forgea/types';
import { modelVariantKey } from '@forgea/validation/constants';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  createProduct,
  CSRF,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';
import { useRoundPricing } from './studio-helpers.js';
import { TextShaper } from '../src/text-studio/text-shaper.js';

const fontFile = (file: string) =>
  readFileSync(new URL(`../prisma/example-fonts/${file}`, import.meta.url));

/**
 * The text studio: fonts uploaded once, a personalised product priced from the piece its
 * design makes (English or Arabic, per-letter fonts and colours), carts and orders keeping
 * the design, print files for the studio, and filament taken per colour.
 */
describe('Text studio (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  const tag = randomUUID().slice(0, 8);
  let cairo: FontView;
  let pacifico: FontView;
  let colours: { red: string; white: string; gold: string };
  let slug: string;
  let productId: string;
  let groupId: string;
  let materialId: string;

  const addFont = async (file: string, name: string) => {
    const uploaded = await http()
      .post('/uploads/font')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', fontFile(file), file)
      .expect(201);
    return (
      await as(admin.cookie)
        .post('/fonts', { fileKey: uploaded.body.key, name })
        .expect(201)
    ).body as FontView;
  };
  const price = (design: object) =>
    http()
      .post(`/products/${slug}/price`)
      .set(CSRF)
      .send({ options: [], design });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    cairo = await addFont('Cairo.ttf', `Cairo ${tag}`);
    pacifico = await addFont('Pacifico.ttf', `Pacifico ${tag}`);
    const group = await prisma.optionGroup.create({
      data: {
        name: `Text colours ${tag}`,
        values: {
          create: [
            // In this order (made in the same instant, their ids alone don't order them).
            { label: 'Red', swatchHex: '#b3282d', sortOrder: 0 },
            { label: 'White', swatchHex: '#f2f2ee', sortOrder: 1 },
            { label: 'Gold', swatchHex: '#c9a227', sortOrder: 2 },
          ],
        },
      },
      include: { values: true },
    });
    const id = (label: string) =>
      group.values.find((v) => v.label === label)!.id;
    colours = { red: id('Red'), white: id('White'), gold: id('Gold') };
    groupId = group.id;
    const material = await prisma.material.findFirstOrThrow({
      where: { code: 'PLA' },
    });
    materialId = material.id;
    slug = `keychain-${tag}`;
    productId = (
      await as(admin.cookie)
        .post('/products', {
          slug,
          name: `Name keychain ${tag}`,
          description: 'Your name on a keychain, in 3D.',
          materialId: material.id,
          grams: '8',
          printHours: '0.8',
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
            maxWidthMm: '75',
            colourGroupId: group.id,
            extraColourPrice: '1.00',
            sizesMm: ['15'],
            defaultColourId: colours.gold,
            defaultBaseColourId: colours.white,
          },
        })
        .expect(201)
    ).body.id as string;
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('a font is read when it is added: its letters, its name; staff may not add one', async () => {
    expect(cairo).toMatchObject({ latin: true, arabic: true, active: true });
    expect(pacifico).toMatchObject({ latin: true, arabic: false });
    const staff = await signedInAs(app, Role.STAFF);
    await as(staff.cookie)
      .post('/fonts', { fileKey: cairo.fileKey })
      .expect(403);
    // The same name twice: refused.
    await as(admin.cookie)
      .post('/fonts', { fileKey: cairo.fileKey, name: cairo.name })
      .expect(409);
    // Fonts customers use are served to browsers (the live preview loads them).
    await http().get(`/media/${cairo.fileKey}`).expect(200);
  });

  it('the dashboard saves it as it sends it: starting colours it leaves empty are null', async () => {
    const saved = await as(admin.cookie)
      .put(`/products/${productId}`, {
        slug,
        name: `Name keychain ${tag}`,
        description: 'Your name on a keychain, in 3D.',
        materialId,
        grams: '8',
        printHours: '0.8',
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
          maxWidthMm: '75',
          colourGroupId: groupId,
          extraColourPrice: '1.00',
          sizesMm: ['15'],
          defaultColourId: colours.gold,
          defaultBaseColourId: colours.white,
          defaultAccentColourId: null,
          decor: null,
          shapes: ['HEART'],
          logoIds: [],
        },
      })
      .expect(200);
    expect(saved.body.text).toMatchObject({
      style: 'KEYCHAIN',
      shapes: ['HEART'],
      defaultColourId: colours.gold,
    });
  });

  it('the product page offers the fonts and colours; a design is priced from the piece it makes', async () => {
    const detail = (await http().get(`/products/${slug}`).expect(200))
      .body as ProductDetail;
    expect(detail.text).toMatchObject({
      style: 'KEYCHAIN',
      maxChars: 12,
      extraColourPrice: '1.00',
    });
    expect(detail.text!.fonts.map((f) => f.id)).toEqual(
      expect.arrayContaining([cairo.id, pacifico.id]),
    );
    // Without a model of its own, it shows "Forgea" made in its style (cards, home bed), in
    // its starting colours: a GLB with a material per colour (gold letters, white backing).
    expect(detail.modelKey).toMatch(/^clean\/.+\.glb$/);
    const sample = await http()
      .get(`/media/${detail.modelKey}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const glb = sample.body as Buffer;
    const gltf = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'),
    ) as { materials: unknown[] };
    expect(gltf.materials).toHaveLength(2);
    // The compressed copy the shop shows is made from it.
    await http()
      .get(`/media/${modelVariantKey(detail.modelKey!, 'view')}`)
      .expect(200);
    expect(detail.text!.colours.map((c) => c.label)).toEqual([
      'Red',
      'White',
      'Gold',
    ]);

    const one = Number(
      (
        await price({
          text: 'Sara',
          fontId: cairo.id,
          textColour: colours.red,
        }).expect(200)
      ).body.unitPrice,
    );
    expect(one).toBeGreaterThan(1);
    // A longer name takes more filament: it costs more.
    const longer = Number(
      (
        await price({
          text: 'Alexandra',
          fontId: cairo.id,
          textColour: colours.red,
        }).expect(200)
      ).body.unitPrice,
    );
    expect(longer).toBeGreaterThan(one);
    // A second colour (the backing): the product's $1.00 more, give or take the same grams.
    const twoColours = Number(
      (
        await price({
          text: 'Sara',
          fontId: cairo.id,
          textColour: colours.red,
          baseColour: colours.white,
        }).expect(200)
      ).body.unitPrice,
    );
    expect(twoColours).toBeCloseTo(one + 1, 1);
    // A bigger size: more filament, a higher price; only the sizes offered.
    expect(detail.text).toMatchObject({
      sizesMm: ['15'],
      defaultColourId: colours.gold,
      defaultBaseColourId: colours.white,
    });
    const bigger = Number(
      (
        await price({
          text: 'Sara',
          fontId: cairo.id,
          textColour: colours.red,
          heightMm: '15',
        }).expect(200)
      ).body.unitPrice,
    );
    expect(bigger).toBeGreaterThan(one);
    expect(
      (
        await price({
          text: 'Sara',
          fontId: cairo.id,
          textColour: colours.red,
          heightMm: '99',
        }).expect(400)
      ).body.message,
    ).toMatch(/sizes offered/);
    // Arabic, in a font that writes it.
    await price({
      text: 'سارة',
      fontId: cairo.id,
      textColour: colours.red,
    }).expect(200);
  });

  it('refuses what it cannot make, in words the customer understands', async () => {
    const reason = async (design: object) =>
      (await price(design).expect(400)).body.message as string;
    expect(
      await reason({
        text: 'سارة',
        fontId: pacifico.id,
        textColour: colours.red,
      }),
    ).toMatch(/This font has no/);
    expect(
      await reason({
        text: 'Sara',
        fontId: randomUUID(),
        textColour: colours.red,
      }),
    ).toMatch(/fonts offered/);
    expect(
      await reason({
        text: 'Sara',
        fontId: cairo.id,
        textColour: randomUUID(),
      }),
    ).toMatch(/colours offered/);
    expect(
      await reason({
        text: 'A name far too long',
        fontId: cairo.id,
        textColour: colours.red,
      }),
    ).toMatch(/At most 12/);
    expect(
      await reason({
        text: '<script>',
        fontId: cairo.id,
        textColour: colours.red,
      }),
    ).toMatch(/letters, numbers/);
  });

  it('decorated templates: a big initial with its name and decorations, two names and a heart', async () => {
    const template = (
      name: string,
      text: Record<string, unknown>,
      status: number,
    ) =>
      as(admin.cookie)
        .post('/products', {
          slug: `${name}-${tag}`,
          name: `${name} ${tag}`,
          description: 'A decorated piece.',
          materialId,
          grams: '50',
          printHours: '3',
          isCustom: false,
          active: true,
          imageKeys: [],
          options: [],
          sizes: [],
          text: {
            maxChars: 12,
            letterHeightMm: '80',
            letterDepthMm: '4',
            baseDepthMm: '3',
            maxWidthMm: '200',
            colourGroupId: groupId,
            extraColourPrice: '2.00',
            sizesMm: [],
            ...text,
          },
        })
        .expect(status);

    // A big initial needs its decorations.
    expect(
      (await template('no-decor', { style: 'INITIAL_NAME' }, 400)).body.message,
    ).toMatch(/decorations/);
    // Decorations sent for another style are dropped, not refused (the dashboard keeps none).
    await template('name-decor', { style: 'NAME', decor: 'STARS' }, 201);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { slug: `name-decor-${tag}` },
        })
      ).textDecor,
    ).toBeNull();

    await template(
      'baby',
      {
        style: 'INITIAL_NAME',
        decor: 'FLOWERS',
        defaultColourId: colours.gold,
        defaultAccentColourId: colours.white,
        defaultBaseColourId: colours.red,
      },
      201,
    );
    const baby = (await http().get(`/products/baby-${tag}`).expect(200))
      .body as ProductDetail;
    expect(baby.text).toMatchObject({
      style: 'INITIAL_NAME',
      decor: 'FLOWERS',
      defaultAccentColourId: colours.white,
    });
    expect(baby.modelKey).toMatch(/^clean\/.+\.glb$/);
    const babyPrice = (design: object) =>
      http()
        .post(`/products/baby-${tag}/price`)
        .set(CSRF)
        .send({ options: [], design });
    const plain = Number(
      (
        await babyPrice({
          text: 'Lina',
          fontId: pacifico.id,
          textColour: colours.gold,
        }).expect(200)
      ).body.unitPrice,
    );
    // The initial and decorations in their own colour: one more colour, $2.00 more.
    const accented = Number(
      (
        await babyPrice({
          text: 'Lina',
          fontId: pacifico.id,
          textColour: colours.gold,
          accentColour: colours.white,
        }).expect(200)
      ).body.unitPrice,
    );
    expect(accented).toBeCloseTo(plain + 2, 0);
    // The initial in its own font makes a different piece.
    const ownFont = Number(
      (
        await babyPrice({
          text: 'Lina',
          fontId: pacifico.id,
          accentFontId: cairo.id,
          textColour: colours.gold,
        }).expect(200)
      ).body.unitPrice,
    );
    expect(ownFont).not.toBe(plain);
    // Only colours and fonts offered; the initial's font must write it.
    expect(
      (
        await babyPrice({
          text: 'Lina',
          fontId: pacifico.id,
          textColour: colours.gold,
          accentColour: randomUUID(),
        }).expect(400)
      ).body.message,
    ).toMatch(/colours offered/);
    expect(
      (
        await babyPrice({
          text: 'ليلى',
          fontId: cairo.id,
          accentFontId: pacifico.id,
          textColour: colours.gold,
        }).expect(400)
      ).body.message,
    ).toMatch(/This font has no/);

    await template(
      'couple',
      {
        style: 'COUPLE',
        maxChars: 10,
        letterHeightMm: '30',
        maxWidthMm: '250',
        defaultAccentColourId: colours.red,
      },
      201,
    );
    const couplePrice = (design: object) =>
      http()
        .post(`/products/couple-${tag}/price`)
        .set(CSRF)
        .send({ options: [], design });
    expect(
      (
        await couplePrice({
          text: 'Sara',
          fontId: cairo.id,
          textColour: colours.gold,
        }).expect(400)
      ).body.message,
    ).toBe('Type both names');
    await couplePrice({
      text: 'سارة & علي',
      fontId: cairo.id,
      textColour: colours.gold,
      accentColour: colours.red,
    }).expect(200);

    // A design for a product that has none is refused, here as in the cart.
    const regular = await createProduct(app, {});
    await http()
      .post(`/products/${regular.slug}/price`)
      .set(CSRF)
      .send({
        options: [],
        design: { text: 'Sara', fontId: cairo.id, textColour: colours.gold },
      })
      .expect(400);

    // In the cart, the names read joined the same way, the heart's colour named.
    const guest = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({
        productId: (
          await prisma.product.findUniqueOrThrow({
            where: { slug: `couple-${tag}` },
          })
        ).id,
        quantity: 1,
        options: [],
        design: {
          text: 'Sara&Ali',
          fontId: pacifico.id,
          textColour: colours.gold,
          accentColour: colours.red,
          baseColour: colours.white,
        },
      })
      .expect(201);
    const cart = guest.body as CartView;
    expect(cart.lines[0]!.design).toMatchObject({
      style: 'COUPLE',
      text: 'Sara & Ali',
      textColour: 'Gold',
      accentColour: 'Red',
      baseColour: 'White',
    });
  });

  it('a starting colour switched off since is not offered: the page starts on an offered one', async () => {
    const group = await prisma.optionGroup.create({
      data: {
        name: `Colours off ${tag}`,
        values: {
          create: [
            { label: 'Copper', swatchHex: '#b87333', sortOrder: 0 },
            { label: 'Black', swatchHex: '#111111', sortOrder: 1 },
          ],
        },
      },
      include: { values: true },
    });
    const copper = group.values.find((v) => v.label === 'Copper')!;
    const offSlug = `colour-off-${tag}`;
    await as(admin.cookie)
      .post('/products', {
        slug: offSlug,
        name: `Colour off ${tag}`,
        description: 'Its starting colour goes.',
        materialId,
        grams: '20',
        printHours: '1',
        isCustom: false,
        active: true,
        imageKeys: [],
        options: [],
        sizes: [],
        text: {
          style: 'NAME',
          maxChars: 12,
          letterHeightMm: '30',
          letterDepthMm: '4',
          baseDepthMm: '3',
          maxWidthMm: '200',
          colourGroupId: group.id,
          extraColourPrice: '1.00',
          sizesMm: [],
          defaultColourId: copper.id,
          defaultBaseColourId: copper.id,
        },
      })
      .expect(201);
    await prisma.optionValue.update({
      where: { id: copper.id },
      data: { active: false },
    });
    const detail = (await http().get(`/products/${offSlug}`).expect(200))
      .body as ProductDetail;
    expect(detail.text!.colours.map((c) => c.label)).toEqual(['Black']);
    expect(detail.text).toMatchObject({
      defaultColourId: null,
      defaultBaseColourId: null,
    });
  });

  it('designed freely: a standing initial with text, decorations and logos placed on it', async () => {
    const boardSlug = `standing-${tag}`;
    await as(admin.cookie)
      .post('/products', {
        slug: boardSlug,
        name: `Standing initial ${tag}`,
        description: 'A baby initial, designed freely.',
        materialId,
        grams: '100',
        printHours: '5',
        isCustom: false,
        active: true,
        imageKeys: [],
        options: [],
        sizes: [],
        text: {
          style: 'STANDING_INITIAL',
          maxChars: 1,
          letterHeightMm: '150',
          letterDepthMm: '2',
          baseDepthMm: '20',
          maxWidthMm: '200',
          colourGroupId: groupId,
          extraColourPrice: '2.00',
          sizesMm: [],
          defaultColourId: colours.white,
          // A boy's looks (a standing initial keeps its decorations as the looks it offers).
          decor: 'STARS',
        },
      })
      .expect(201);
    const detail = (await http().get(`/products/${boardSlug}`).expect(200))
      .body as ProductDetail;
    expect(detail.text).toMatchObject({
      style: 'STANDING_INITIAL',
      decor: 'STARS',
    });
    expect(detail.modelKey).toMatch(/^clean\/.+\.glb$/);
    const boardPrice = (design: object) =>
      http()
        .post(`/products/${boardSlug}/price`)
        .set(CSRF)
        .send({ options: [], design });
    const item = (over: object) => ({
      id: randomUUID().slice(0, 8),
      kind: 'TEXT',
      text: 'Ayla',
      x: 0,
      y: 0,
      size: 25,
      rotation: 0,
      colour: colours.red,
      ...over,
    });
    const design = (items: object[]) => ({
      text: 'A',
      fontId: cairo.id,
      textColour: colours.white,
      items,
    });
    const plain = Number(
      (await boardPrice(design([])).expect(200)).body.unitPrice,
    );
    const dressed = Number(
      (
        await boardPrice(
          design([
            item({ fontId: pacifico.id }),
            item({ text: '22.08.2025', y: -30, size: 10 }),
            item({
              kind: 'MOTIF',
              motif: 'HEART',
              text: undefined,
              x: 40,
              y: 50,
              size: 12,
            }),
          ]),
        ).expect(200)
      ).body.unitPrice,
    );
    // A second colour and more filament: it costs more.
    expect(dressed).toBeGreaterThan(plain);

    const reason = async (items: object[]) =>
      (await boardPrice(design(items)).expect(400)).body.message as string;
    expect(await reason([item({ colour: randomUUID() })])).toMatch(
      /colours offered/,
    );
    expect(await reason([item({ fontId: randomUUID() })])).toMatch(
      /fonts offered/,
    );
    expect(
      await reason([
        item({ kind: 'LOGO', text: undefined, logoId: randomUUID() }),
      ]),
    ).toMatch(/logos offered/);
    expect(
      await reason([item({ kind: 'MOTIF', motif: 'DRAGON', text: undefined })]),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/decoration/)]));
    expect(
      (
        await http()
          .post(`/products/${boardSlug}/price`)
          .set(CSRF)
          .send({ options: [], design: { ...design([]), text: 'AB' } })
          .expect(400)
      ).body.message,
    ).toMatch(/one letter/);
    // Checkout builds it on the server: an item far off the piece is refused there.
    const cart = await signedInCustomer(app);
    const added = await as(cart.cookie).post('/cart/items', {
      productId: detail.id,
      quantity: 1,
      design: design([item({ x: 900, y: 900 })]),
    });
    expect(added.status).toBe(400);
    expect(added.body.message).toMatch(/on the piece/);
  });

  it('the cart keeps each design as its own line; the order keeps it; the studio downloads its print files', async () => {
    const customer = await signedInCustomer(app);
    const add = (text: string) =>
      as(customer.cookie)
        .post('/cart/items', {
          productId,
          quantity: 1,
          options: [],
          design: {
            text,
            fontId: cairo.id,
            textColour: colours.red,
            baseColour: colours.white,
          },
        })
        .expect(201);
    await add('Maya');
    await add('Maya');
    const cart = (await add('Omar')).body as CartView;
    const maya = cart.lines.find((l) => l.design?.text === 'Maya')!;
    expect(maya).toMatchObject({
      quantity: 2,
      design: {
        style: 'KEYCHAIN',
        font: cairo.name,
        textColour: 'Red',
        baseColour: 'White',
      },
    });
    // What it takes to print never reaches the browser.
    expect(JSON.stringify(cart)).not.toMatch(/grams|printHours/);
    expect(maya.design!.sizeMm.x).toBeLessThanOrEqual(75.1);
    // A design is required.
    await as(customer.cookie)
      .post('/cart/items', { productId, quantity: 1, options: [] })
      .expect(400);

    const placed = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .set(
        HTTP.PROXY_SECRET_HEADER,
        app.get(ConfigService).getOrThrow<string>('INTERNAL_PROXY_SECRET'),
      )
      .set(HTTP.FORWARDED_CLIENT_IP_HEADER, '10.77.0.1')
      .send({
        idempotencyKey: randomUUID(),
        name: 'Maya Text',
        phone: '70 123 456',
        paymentMethod: 'COD',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber as string },
    });
    const staffOrder = (
      await as(admin.cookie).get(`/orders/${order.id}`).expect(200)
    ).body as StaffOrder;
    const line = staffOrder.items.find((i) => i.design?.text === 'Maya')!;
    expect(line.design!.files.map((f) => f.colour).sort()).toEqual([
      'Red',
      'White',
    ]);

    const url = `/orders/${order.id}/items/${line.design!.itemId}/print/White`;
    const stl = await as(admin.cookie)
      .get(url)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const bytes = stl.body as Buffer;
    expect(stl.headers['content-disposition']).toMatch(
      new RegExp(`${order.orderNumber}-white\\.stl`),
    );
    expect(bytes.byteLength).toBe(84 + bytes.readUInt32LE(80) * 50);
    await as(customer.cookie).get(url).expect(403);
    await as(admin.cookie)
      .get(`/orders/${order.id}/items/${line.design!.itemId}/print/Purple`)
      .expect(404);

    // Into production: each colour's grams come off its reel.
    await as(admin.cookie)
      .patch(`/orders/${order.id}/status`, { status: 'CONFIRMED' })
      .expect(200);
    await as(admin.cookie)
      .patch(`/orders/${order.id}/status`, { status: 'IN_PRODUCTION' })
      .expect(200);
    const taken = await prisma.stockMovement.findMany({
      where: { orderItem: { orderId: order.id }, kind: 'ORDER' },
      include: { stockItem: { select: { colour: true } } },
    });
    expect(new Set(taken.map((m) => m.stockItem.colour))).toEqual(
      new Set(['Red', 'White']),
    );
    // Two lines (Maya ×2, Omar) in two colours each: four movements.
    expect(taken).toHaveLength(4);
  });

  it('the live price and the cart use what the browser built; only checkout builds it on the server', async () => {
    const shaper = app.get(TextShaper);
    const built = vi.spyOn(shaper, 'measure');
    const design = { text: 'Lina', fontId: cairo.id, textColour: colours.red };
    const browser = (volumeMm3: number, colour = colours.red) => ({
      parts: [{ colour, volumeMm3 }],
      size: { x: 60, y: 20, z: 8 },
    });
    const priced = (measured: object) =>
      http()
        .post(`/products/${slug}/price`)
        .set(CSRF)
        .send({ options: [], design, measured });

    const small = Number(
      (await priced(browser(1500)).expect(200)).body.unitPrice,
    );
    const large = Number(
      (await priced(browser(6000)).expect(200)).body.unitPrice,
    );
    expect(large).toBeGreaterThan(small);
    // Nothing that can't be this design: another colour, or more solid than the piece's box.
    await priced(browser(1500, colours.gold)).expect(400);
    await priced(browser(9601)).expect(400);
    await priced({ parts: [], size: { x: 1, y: 1, z: 1 } }).expect(400);
    expect(built).not.toHaveBeenCalled();

    // A browser that claims almost no filament: the cart shows its price, but the order is
    // priced from the piece as the server builds it at checkout.
    const customer = await signedInCustomer(app);
    const cart = (
      await as(customer.cookie)
        .post('/cart/items', {
          productId,
          quantity: 1,
          options: [],
          design,
          measured: browser(1),
        })
        .expect(201)
    ).body as CartView;
    expect(built).not.toHaveBeenCalled();
    const claimed = Number(
      cart.lines.find((l) => l.design?.text === 'Lina')!.unitPrice,
    );
    const real = Number((await price(design).expect(200)).body.unitPrice);
    expect(built).toHaveBeenCalledTimes(1);
    expect(real).toBeGreaterThan(claimed);

    const placed = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .set(
        HTTP.PROXY_SECRET_HEADER,
        app.get(ConfigService).getOrThrow<string>('INTERNAL_PROXY_SECRET'),
      )
      .set(HTTP.FORWARDED_CLIENT_IP_HEADER, '10.77.0.2')
      .send({
        idempotencyKey: randomUUID(),
        name: 'Lina Text',
        phone: '70 123 457',
        paymentMethod: 'COD',
        delivery: false,
      })
      .expect(201);
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { orderNumber: placed.body.orderNumber as string } },
    });
    expect(Number(item.unitPrice)).toBe(real);
    built.mockRestore();
  });

  it('a catalog file carries the fonts and how personalised products are made', async () => {
    const exported = (
      await as(admin.cookie).get('/catalog-transfer/export').expect(200)
    ).body as {
      fonts: { name: string; file: { base64: string } }[];
      products: { slug: string; text: { colourGroup: string } | null }[];
    };
    const font = exported.fonts.find((f) => f.name === cairo.name)!;
    expect(font.file.base64.length).toBeGreaterThan(1000);
    expect(exported.products.find((p) => p.slug === slug)!.text).toMatchObject({
      style: 'KEYCHAIN',
      colourGroup: `Text colours ${tag}`,
    });

    // Only the personalised-text products, with what they use and nothing else.
    const textOnly = (
      await as(admin.cookie)
        .get('/catalog-transfer/export?only=text')
        .expect(200)
    ).body as typeof exported & {
      optionGroups: { name: string }[];
      materials: { code: string }[];
    };
    expect(textOnly.products.length).toBeGreaterThan(0);
    expect(textOnly.products.every((p) => p.text !== null)).toBe(true);
    expect(textOnly.products.map((p) => p.slug)).toContain(slug);
    expect(textOnly.optionGroups.map((g) => g.name)).toContain(
      `Text colours ${tag}`,
    );
    const groupNames = new Set(textOnly.optionGroups.map((g) => g.name));
    for (const p of textOnly.products as unknown as {
      options: { group: string }[];
      material: string;
    }[]) {
      for (const o of p.options) expect(groupNames.has(o.group)).toBe(true);
      expect(textOnly.materials.map((m) => m.code)).toContain(p.material);
    }
    expect(textOnly.fonts.find((f) => f.name === cairo.name)).toBeTruthy();
    await as(admin.cookie)
      .get('/catalog-transfer/export?only=nonsense')
      .expect(400);
  });
});
