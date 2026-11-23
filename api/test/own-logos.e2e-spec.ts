import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AdminProduct,
  CustomerLogoView,
  FontView,
  Page,
  ProductDetail,
  ProductListItem,
} from '@forgea/types';
import request from 'supertest';
import { cube } from '../prisma/example-models.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';

const fontFile = (file: string) =>
  readFileSync(new URL(`../prisma/example-fonts/${file}`, import.meta.url));

/** A customer's logo: a ring (as their browser traces a picture into an SVG). */
const RING =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill-rule="evenodd" d="M5 5L35 5L35 35L5 35ZM15 15L15 25L25 25L25 15Z"/></svg>';

/** A logo in two colours: a light badge, a dark square drawn on it. */
const TWO_COLOURS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="0" y="0" width="40" height="40" fill="#f0f0f0"/><rect x="12" y="12" width="16" height="16" fill="#101010"/></svg>';

/**
 * Customers bring their own logo: read like the studio's into an outline (anyone may, before
 * signing up), then raised alone or beside their name on a keychain that lets them, or put in
 * a product's logo place they may change; the Design page lists both kinds of piece.
 */
describe('Customers’ own logos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  const tag = randomUUID().slice(0, 8);
  let theirs: CustomerLogoView;
  let font: FontView;
  let white: string;
  let black: string;
  let groupId: string;
  let materialId: string;

  const post = (url: string, body: object) =>
    http().post(url).set(CSRF).set('Cookie', admin.cookie).send(body);
  const product = (extra: object) => ({
    description: 'Made yours.',
    materialId,
    grams: '8',
    printHours: '0.8',
    isCustom: false,
    active: true,
    imageKeys: [],
    options: [],
    sizes: [],
    ...extra,
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    const uploaded = await http()
      .post('/uploads/font')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', fontFile('Cairo.ttf'), 'Cairo.ttf')
      .expect(201);
    font = (
      await post('/fonts', {
        fileKey: uploaded.body.key,
        name: `Cairo ${tag}`,
      }).expect(201)
    ).body as FontView;
    const group = await prisma.optionGroup.create({
      data: {
        name: `Own logo colours ${tag}`,
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
    materialId = (
      await prisma.material.findUniqueOrThrow({ where: { code: 'PLA' } })
    ).id;
  });
  afterAll(() => app.close());

  it('anyone brings a logo: an SVG read into an outline, nothing else kept', async () => {
    const res = await http()
      .post('/logos/yours')
      .set(CSRF)
      .attach('file', Buffer.from(RING), 'logo.svg')
      .expect(201);
    theirs = res.body as CustomerLogoView;
    expect(theirs.outline).toHaveLength(1);
    expect(theirs.outline[0]!.holes).toHaveLength(1);
    // Not a drawing, or nothing in it: refused with the reason.
    await http()
      .post('/logos/yours')
      .set(CSRF)
      .attach('file', Buffer.from('not a picture'), 'logo.svg')
      .expect(400);
    await http().post('/logos/yours').set(CSRF).expect(400);
    // It is theirs to use, not one of the studio's logos.
    const studio = await http()
      .get('/logos')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(studio.body.map((l: { id: string }) => l.id)).not.toContain(
      theirs.id,
    );
  });

  it('a keychain that lets them: their logo beside the name, or alone', async () => {
    const text = (ownLogo: boolean) => ({
      style: 'KEYCHAIN',
      maxChars: 12,
      letterHeightMm: '10',
      letterDepthMm: '1.6',
      baseDepthMm: '2.4',
      maxWidthMm: '75',
      colourGroupId: groupId,
      extraColourPrice: '1.00',
      sizesMm: [],
      shapes: ['ROUNDED'],
      logoIds: [],
      ownLogo,
    });
    const open = (
      await post(
        '/products',
        product({
          slug: `logo-tag-${tag}`,
          name: `Logo tag ${tag}`,
          text: text(true),
        }),
      ).expect(201)
    ).body as AdminProduct;
    expect(open.text?.ownLogo).toBe(true);
    const closed = (
      await post(
        '/products',
        product({
          slug: `name-tag-${tag}`,
          name: `Name tag ${tag}`,
          text: text(false),
        }),
      ).expect(201)
    ).body as AdminProduct;
    const page = (await http().get(`/products/${open.slug}`).expect(200))
      .body as ProductDetail;
    expect(page.text?.ownLogo).toBe(true);

    const design = (extra: object) => ({
      text: 'Sara',
      fontId: font.id,
      textColour: white,
      baseColour: black,
      ...extra,
    });
    const price = (slug: string, d: object) =>
      http()
        .post(`/products/${slug}/price`)
        .set(CSRF)
        .send({ options: [], design: d });
    const named = Number(
      (await price(open.slug, design({})).expect(200)).body.unitPrice,
    );
    const withLogo = Number(
      (await price(open.slug, design({ logoId: theirs.id })).expect(200)).body
        .unitPrice,
    );
    expect(withLogo).toBeGreaterThanOrEqual(named);
    // The logo alone, on its rounded tag.
    await price(
      open.slug,
      design({ text: '', logoId: theirs.id, shape: 'ROUNDED' }),
    ).expect(200);
    // No name and no logo: nothing to make.
    const empty = await price(open.slug, design({ text: '' })).expect(400);
    expect(empty.body.message).toMatch(/Type the text/);
    // A keychain that doesn't let them, or a logo that isn't theirs: refused.
    await price(closed.slug, design({ logoId: theirs.id })).expect(400);
    await price(open.slug, design({ logoId: randomUUID() })).expect(400);
    // Only keychains take their own logo (the database holds it too).
    await post(
      '/products',
      product({
        slug: `own-name-${tag}`,
        name: `Own name ${tag}`,
        text: { ...text(true), style: 'NAME' },
      }),
    ).expect(201);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { slug: `own-name-${tag}` },
        })
      ).textOwnLogo,
    ).toBe(false);
  });

  it('a place for their logo on any product: empty until they add theirs', async () => {
    const model = await http()
      .post('/uploads/product-model')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .attach('file', Buffer.from(cube(40)), 'cube.stl')
      .expect(201);
    const place = {
      id: 'their-logo',
      kind: 'LOGO',
      label: 'Your logo',
      editable: true,
      placement: { origin: [20, 0, 20], normal: [0, -1, 0], up: [0, 0, 1] },
      heightMm: 20,
      maxWidthMm: 30,
      depthMm: 1,
      colour: white,
      defaultOn: true,
    };
    const dto = product({
      slug: `logo-cube-${tag}`,
      name: `Logo cube ${tag}`,
      grams: '40',
      printHours: '2',
      modelFileKey: model.body.key,
      partColourGroupId: groupId,
    });
    // Without a logo of the studio's, only a place customers may change.
    await post('/products', {
      ...dto,
      slots: [{ ...place, editable: false }],
    }).expect(400);
    const cubeProduct = (
      await post('/products', { ...dto, slots: [place] }).expect(201)
    ).body as AdminProduct;
    expect(cubeProduct.slots[0]).not.toHaveProperty('logoId');

    const price = (slots: object[]) =>
      http()
        .post(`/products/${cubeProduct.slug}/price`)
        .set(CSRF)
        .send({ options: [], slots });
    const bare = Number((await price([]).expect(200)).body.unitPrice);
    const mine = Number(
      (await price([{ slotId: 'their-logo', logoId: theirs.id }]).expect(200))
        .body.unitPrice,
    );
    expect(mine).toBeGreaterThanOrEqual(bare);
    const refused = await price([
      { slotId: 'their-logo', logoId: randomUUID() },
    ]).expect(400);
    expect(refused.body.message).toMatch(/add your logo again/);
  });

  it('a logo in colours keeps them: a filament for each, on a keychain and in a logo place', async () => {
    // A white badge with a black mark on it, traced from their picture into two colours.
    const coloured = (
      await http()
        .post('/logos/yours')
        .set(CSRF)
        .attach('file', Buffer.from(TWO_COLOURS), 'logo.svg')
        .expect(201)
    ).body as CustomerLogoView;
    expect(coloured.inks?.map((i) => i.hex)).toEqual(['#f0f0f0', '#101010']);
    // The one-colour ring has none.
    expect(theirs.inks).toBeNull();

    const design = {
      text: 'Sara',
      fontId: font.id,
      textColour: white,
      baseColour: black,
      logoId: coloured.id,
    };
    const price = (d: object) =>
      http()
        .post(`/products/logo-tag-${tag}/price`)
        .set(CSRF)
        .send({ options: [], design: d });
    await price({ ...design, logoColours: [white, black] }).expect(200);
    // One colour for each of the logo's, each one offered.
    const short = await price({ ...design, logoColours: [white] }).expect(400);
    expect(short.body.message).toMatch(/a colour for each/);
    await price({ ...design, logoColours: [white, randomUUID()] }).expect(400);
    // On a one-colour logo, colours of its own are refused.
    await price({
      ...design,
      logoId: theirs.id,
      logoColours: [white, black],
    }).expect(400);

    // In a logo place: printed in the colours chosen, both counted.
    const placed = await http()
      .post(`/products/logo-cube-${tag}/price`)
      .set(CSRF)
      .send({
        options: [],
        slots: [
          {
            slotId: 'their-logo',
            logoId: coloured.id,
            logoColours: [black, white],
          },
        ],
      })
      .expect(200);
    expect(placed.body.unitPrice).toBeDefined();
    await http()
      .post(`/products/logo-cube-${tag}/price`)
      .set(CSRF)
      .send({
        options: [],
        slots: [
          { slotId: 'their-logo', logoId: coloured.id, logoColours: [black] },
        ],
      })
      .expect(400);
  });

  it('the Design page lists pieces from their logo, and every piece they make theirs', async () => {
    const list = async (design: string) =>
      (
        (
          await http()
            .get(
              `/products?design=${design}&limit=100&sort=createdAt&order=desc`,
            )
            .expect(200)
        ).body as Page<ProductListItem>
      ).items.map((p) => p.slug);
    const fromLogo = await list('logo');
    expect(fromLogo).toContain(`logo-tag-${tag}`);
    expect(fromLogo).not.toContain(`name-tag-${tag}`);
    const yours = await list('yours');
    expect(yours).toEqual(
      expect.arrayContaining([
        `logo-tag-${tag}`,
        `name-tag-${tag}`,
        `logo-cube-${tag}`,
      ]),
    );
    await http().get('/products?design=everything').expect(400);
  });
});
