import type { AdminProduct, ProductDetail } from '@forgea/types';
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
import { bambuThreeMf } from './three-mf-file.js';

/**
 * A 3MF product whose parts customers recolour: the owner names a part, picks the colours it
 * may be printed in and the one it starts in; the shop offers each part with those colours,
 * priced by each colour's own add-on; the order records "Body: Copper silk" and stock takes the
 * part's grams from the colour chosen.
 */
describe('3MF parts customers recolour (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let restorePricing: () => Promise<void>;
  let studio: Studio;
  let groupId: string;
  let red: string;
  let silk: string;
  let modelKey: string;

  const put = (p: AdminProduct, extra: object) =>
    http()
      .put(`/products/${p.id}`)
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .send({
        slug: p.slug,
        name: p.name,
        description: p.description,
        materialId: p.materialId,
        grams: p.grams,
        printHours: p.printHours,
        isCustom: p.isCustom,
        active: p.active,
        imageKeys: p.imageKeys,
        modelFileKey: modelKey,
        options: [],
        sizes: [],
        colours: [],
        ...extra,
      });
  const manage = async () =>
    (
      await http()
        .get(`/products/manage/${studio.product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200)
    ).body as AdminProduct;
  const detail = async () =>
    (await http().get(`/products/${studio.product.slug}`).expect(200))
      .body as ProductDetail;
  const price = async (options: object[], status = 200) =>
    (
      await http()
        .post(`/products/${studio.product.slug}/price`)
        .set(CSRF)
        .send({ options })
        .expect(status)
    ).body as { unitPrice: string };

  const parts = (body: string, trim: string, extra = {}) => [
    { colour: body, hex: '#aa2222', grams: '80', part: 'Body', ...extra },
    { colour: trim, hex: '#b87333', grams: '20', part: 'Trim' },
  ];

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    restorePricing = await useRoundPricing(app, admin.cookie);
    studio = await createStudio(app);
    const group = await prisma.optionGroup.findUniqueOrThrow({
      where: { name: studio.colourGroup },
      include: { values: true },
    });
    groupId = group.id;
    red = group.values.find((v) => v.label === 'Red')!.id;
    silk = group.values.find((v) => v.label === 'Copper silk')!.id;
    modelKey = (
      await http()
        .post('/uploads/product-model')
        .set(CSRF)
        .set('Cookie', admin.cookie)
        .attach('file', bambuThreeMf({ sliced: true }), 'panda.gcode.3mf')
        .expect(201)
    ).body.key as string;
  });
  afterAll(async () => {
    await restorePricing();
    await app.close();
  });

  it('refuses parts the shop could not sell', async () => {
    const p = await manage();
    // No colours to choose from.
    await put(p, { colours: parts('Red', 'Copper silk') }).expect(400);
    // Starting in a colour customers can't pick.
    await put(p, {
      colours: parts('Blue', 'Copper silk'),
      partColourGroupId: groupId,
    }).expect(400);
    // Two parts with one name, or a part named like an option.
    await put(p, {
      colours: parts('Red', 'Copper silk').map((c) => ({
        ...c,
        part: 'Body',
      })),
      partColourGroupId: groupId,
    }).expect(400);
    await put(p, {
      colours: parts('Red', 'Copper silk', { part: 'size' }),
      partColourGroupId: groupId,
    }).expect(400);
    const long = await put(p, {
      colours: parts('Red', 'Copper silk', { part: 'x'.repeat(41) }),
      partColourGroupId: groupId,
    }).expect(400);
    expect(JSON.stringify(long.body)).toContain('At most 40');
  });

  it('offers each part with the group’s colours, starting where the owner set it', async () => {
    const saved = (
      await put(await manage(), {
        colours: parts('Red', 'Copper silk'),
        partColourGroupId: groupId,
      }).expect(200)
    ).body as AdminProduct;
    expect(saved.partColourGroupId).toBe(groupId);
    expect(saved.colours.map((c) => c.part)).toEqual(['Body', 'Trim']);

    const shop = await detail();
    expect(
      shop.options.map((o) => [o.name, o.defaultValueId, o.recolours]),
    ).toEqual([
      ['Body', red, '#aa2222'],
      ['Trim', silk, '#b87333'],
    ]);
    expect(shop.options[0]!.choices.map((c) => c.label)).toEqual([
      'Copper silk',
      'Red',
    ]);
    const [body, trim] = shop.options.map((o) => o.groupId) as [string, string];
    // The shop's price starts with the trim in copper silk (+$2).
    const allRed = await price([
      { groupId: body, valueId: red },
      { groupId: trim, valueId: red },
    ]);
    expect((Number(shop.price) - Number(allRed.unitPrice)).toFixed(2)).toBe(
      '2.00',
    );
    const allSilk = await price([
      { groupId: body, valueId: silk },
      { groupId: trim, valueId: silk },
    ]);
    expect(
      (Number(allSilk.unitPrice) - Number(allRed.unitPrice)).toFixed(2),
    ).toBe('4.00');
    // Anything but one of the part colours is refused.
    await price([{ groupId: body, valueId: studio.product.id }], 400);

    // Saving again keeps the parts' ids, so carts holding them still work.
    await put(saved, {
      colours: saved.colours,
      partColourGroupId: groupId,
    }).expect(200);
    expect((await detail()).options.map((o) => o.groupId)).toEqual([
      body,
      trim,
    ]);
  });

  it('orders record each part’s colour; stock takes its grams from that colour', async () => {
    const [body, trim] = (await detail()).options.map((o) => o.groupId) as [
      string,
      string,
    ];
    const customer = await signedInAs(app, Role.CUSTOMER);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      {
        size: 'standard',
        colour: 'red',
        quantity: 2,
        options: [
          { groupId: body, valueId: silk },
          { groupId: trim, valueId: silk },
        ],
      },
      { paymentMethod: 'COD', delivery: false },
    );
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(line.options).toEqual([
      { group: 'Body', value: 'Copper silk' },
      { group: 'Trim', value: 'Copper silk' },
    ]);

    const staff = await signedInAs(app, Role.STAFF);
    await moveOrder(app, staff.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const taken = await prisma.stockMovement.findMany({
      where: { orderItemId: line.id, kind: 'ORDER' },
      include: { stockItem: true },
    });
    // Both parts in copper silk: 100 g a piece, two pieces, from one reel.
    expect(taken.map((m) => [m.stockItem.colour, m.grams])).toEqual([
      ['Copper silk', -200],
    ]);
  });

  it('a catalog file carries the parts and the colours they are chosen from', async () => {
    const file = (
      await http()
        .get('/catalog-transfer/export')
        .set('Cookie', admin.cookie)
        .expect(200)
    ).body as {
      products: {
        slug: string;
        partColourGroup?: string;
        colours?: { part?: string }[];
      }[];
    };
    const mine = file.products.find((p) => p.slug === studio.product.slug)!;
    expect(mine.partColourGroup).toBe(studio.colourGroup);
    expect(mine.colours?.map((c) => c.part)).toEqual(['Body', 'Trim']);
  });
});
