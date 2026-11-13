import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
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
} from './studio-helpers.js';

/**
 * Deleting dashboard records: a record still used by history (orders, quotation lines, stock
 * movements, print runs, leads, products) is refused with what uses it; one nothing depends
 * on is deleted with what only belongs to it. Each needs its own permission.
 */
describe('Deleting records, refused while history uses them (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  let studio: Studio;
  const tag = () => randomUUID().slice(0, 8);
  const del = (url: string, cookie = admin.cookie) =>
    request(app.getHttpServer()).delete(url).set(CSRF).set('Cookie', cookie);
  const ask = (url: string, cookie = admin.cookie) =>
    request(app.getHttpServer()).get(url).set('Cookie', cookie);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    studio = await createStudio(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps a product that was ordered, deletes one nobody used (with its sizes and options)', async () => {
    const customer = await signedInAs(app, Role.CUSTOMER);
    const order = await placeOrder(
      app,
      customer.cookie,
      studio,
      { size: 'standard', colour: 'red', quantity: 1 },
      { paymentMethod: 'COD', delivery: false },
    );
    await moveOrder(app, admin.cookie, order.id, [
      'CONFIRMED',
      'IN_PRODUCTION',
    ]);
    const refused = await del(`/products/${studio.product.id}`).expect(409);
    expect(refused.body.message).toMatch(/1 order lines.*Visible in the shop/);
    // Its material and category are used too.
    expect(
      (await del(`/materials/${studio.material.id}`).expect(409)).body.message,
    ).toMatch(/products/);
    expect(
      (await del(`/categories/${studio.category.id}`).expect(409)).body.message,
    ).toMatch(/1 products/);

    const spare = await prisma.product.create({
      data: {
        slug: `spare-${tag()}`,
        name: 'Spare',
        description: 'Never sold.',
        grams: 10,
        printHours: 1,
        materialId: studio.material.id,
        sizes: {
          create: [
            {
              label: 'One',
              sizeXcm: 1,
              sizeYcm: 1,
              sizeZcm: 1,
              grams: 10,
              printHours: 1,
            },
          ],
        },
      },
    });
    // Asked first, nothing is deleted: the ordered one is kept by its order line, the spare
    // goes with its size.
    const kept = await ask(`/products/${studio.product.id}/deletion`).expect(
      200,
    );
    expect(kept.body).toMatchObject({
      id: studio.product.id,
      deletable: false,
      blockedBy: [{ count: 1, what: 'order lines' }],
      instead: expect.stringMatching(/Visible in the shop/),
    });
    const going = await ask(`/products/${spare.id}/deletion`).expect(200);
    expect(going.body).toMatchObject({
      name: 'Spare',
      deletable: true,
      blockedBy: [],
      removes: [{ count: 1, what: 'sizes' }],
      instead: null,
    });
    expect(await prisma.product.count({ where: { id: spare.id } })).toBe(1);

    await del(`/products/${spare.id}`).expect(204);
    expect(await prisma.product.count({ where: { id: spare.id } })).toBe(0);
    expect(
      await prisma.productSize.count({ where: { productId: spare.id } }),
    ).toBe(0);
    await del(`/products/${spare.id}`).expect(404);
  });

  it('keeps a filament with movements and an option offered by a product; deletes unused ones', async () => {
    const reel = await prisma.stockItem.create({
      data: {
        materialId: studio.material.id,
        colour: `Unused ${tag()}`,
        lowStockGrams: 0,
      },
    });
    await del(`/stock/items/${reel.id}`).expect(204);
    const used = (await prisma.stockItem.findFirst({
      where: { materialId: studio.material.id, movements: { some: {} } },
    }))!;
    expect(
      (await del(`/stock/items/${used.id}`).expect(409)).body.message,
    ).toMatch(/stock movements.*Track this filament/);
    expect(
      (await ask(`/stock/items/${used.id}/deletion`).expect(200)).body,
    ).toMatchObject({
      deletable: false,
      name: expect.stringContaining(used.colour),
    });

    const group = await prisma.optionGroup.findUniqueOrThrow({
      where: { name: studio.colourGroup },
      include: { values: true },
    });
    expect(
      (await del(`/option-groups/${group.id}`).expect(409)).body.message,
    ).toMatch(/products offering it/);
    const red = group.values.find((v) => v.label === 'Red')!;
    await del(`/option-groups/values/${red.id}`).expect(409);
    const loose = await prisma.optionValue.create({
      data: { groupId: group.id, label: `Loose ${tag()}` },
    });
    await del(`/option-groups/values/${loose.id}`).expect(204);
    const empty = await prisma.optionGroup.create({
      data: { name: `Empty ${tag()}` },
    });
    await del(`/option-groups/${empty.id}`).expect(204);
  });

  it('deletes a lead with its notes, keeps its quotation; quotations are cancelled, never deleted', async () => {
    const stage = await prisma.leadStage.findFirstOrThrow({
      where: { isWon: false, isQuoted: false },
    });
    const lead = await prisma.lead.create({
      data: {
        name: 'Test lead',
        email: `lead-${tag()}@example.com`,
        message: 'A lamp',
        stageId: stage.id,
        source: 'MANUAL',
      },
    });
    const draft = await request(app.getHttpServer())
      .post('/quotations')
      .set(CSRF)
      .set('Cookie', admin.cookie)
      .send({
        customerEmail: lead.email,
        leadId: lead.id,
        validUntil: '2099-12-31',
        customerName: 'Test lead',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
        lines: [{ description: 'A lamp', quantity: 1, unitPrice: '10' }],
      })
      .expect(201);
    await del(`/leads/${lead.id}`).expect(204);
    expect(
      (
        await prisma.quotation.findUniqueOrThrow({
          where: { id: draft.body.id },
        })
      ).leadId,
    ).toBeNull();

    // Quotations keep their history: there is no delete, they are cancelled.
    await del(`/quotations/${draft.body.id}`).expect(404);
  });

  it('keeps the Won and Quoted stages and a printer with runs; needs each permission', async () => {
    const won = await prisma.leadStage.findFirstOrThrow({
      where: { isWon: true },
    });
    expect(
      (await del(`/lead-stages/${won.id}`).expect(409)).body.message,
    ).toMatch(/Won and Quoted/);
    expect(
      (await ask(`/lead-stages/${won.id}/deletion`).expect(200)).body,
    ).toMatchObject({
      deletable: false,
      instead: expect.stringMatching(/Won and Quoted/),
    });
    const reason = await prisma.lostReason.create({
      data: { name: `Too far ${tag()}` },
    });
    await del(`/lost-reasons/${reason.id}`).expect(204);
    const printer = await prisma.printer.create({
      data: { name: `Spare ${tag()}`, watts: 100 },
    });
    await del(`/printers/${printer.id}`).expect(204);

    const designer = await signedInAs(app, Role.DESIGNER);
    const customer = await signedInAs(app, Role.CUSTOMER);
    await del(`/products/${studio.product.id}`, customer.cookie).expect(403);
    await del(`/leads/${randomUUID()}`, designer.cookie).expect(403);
    await del(`/printers/${randomUUID()}`, designer.cookie).expect(403);
    await ask(`/printers/${randomUUID()}/deletion`, designer.cookie).expect(
      403,
    );
    await ask(`/printers/${randomUUID()}/deletion`).expect(404);
    await request(app.getHttpServer())
      .delete(`/products/${studio.product.id}`)
      .set(CSRF)
      .expect(401);
  });
});
