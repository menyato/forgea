import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  cubeStl,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';

const checkoutForm = () => ({
  idempotencyKey: randomUUID(),
  name: 'Rana Khoury',
  phone: '70 123 456',
  paymentMethod: 'TRANSFER',
  delivery: false,
});

/** "Make me something": request → quote → accept → order awaiting the deposit. */
describe('Custom requests (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    upload: (bytes: Buffer, name: string) =>
      http()
        .post('/custom-requests/files')
        .set(CSRF)
        .set('Cookie', cookie)
        .attach('file', bytes, name),
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: { customUploadMaxMb: 50 },
    });
    await app.close();
  });

  it('the full journey: file, instant estimate, quote, acceptance; every step in the history', async () => {
    const customer = await signedInCustomer(app);
    const me = as(customer.cookie);

    // A 40 mm cube: 64 cm³; at 40% solidity in the cheapest material that is a few dollars.
    const file = await me.upload(cubeStl(40), 'cube.stl').expect(201);
    expect(file.body.key).toMatch(/^clean\/.+\.stl$/);
    const estimate = await me
      .post('/custom-requests/estimate', {
        fileKey: file.body.key,
        quantity: 2,
      })
      .expect(200);
    expect(estimate.body.estimate).toMatchObject({
      low: expect.stringMatching(/^\d+\.00$/),
      high: expect.stringMatching(/^\d+\.00$/),
    });
    expect(Number(estimate.body.estimate.high)).toBeGreaterThan(
      Number(estimate.body.estimate.low),
    );

    const created = await me
      .post('/custom-requests', {
        title: 'Shelf bracket',
        description: 'Two brackets for a 20 mm pine shelf, matte black.',
        quantity: 2,
        colour: 'Black',
        fileKey: file.body.key,
      })
      .expect(201);
    const number: string = created.body.requestNumber;
    expect(created.body).toMatchObject({
      status: 'SUBMITTED',
      file: { key: file.body.key, kind: 'model' },
      estimate: {
        low: estimate.body.estimate.low,
        high: estimate.body.estimate.high,
      },
      quote: null,
    });
    // The owner can see their own file; another customer can't.
    await me.get(`/media/${file.body.key}`).expect(200);
    await as((await signedInCustomer(app)).cookie)
      .get(`/media/${file.body.key}`)
      .expect(404);
    await http().get(`/media/${file.body.key}`).expect(404);

    // Staff see it in the inbox and quote it; it stays open for the owner's 7 days.
    const staff = await signedInAs(app, Role.STAFF);
    await me.get('/custom-requests').expect(403);
    const inbox = await as(staff.cookie)
      .get(`/custom-requests?status=SUBMITTED&q=${number}`)
      .expect(200);
    const id: string = inbox.body.items[0].id;
    expect(inbox.body.items[0]).toMatchObject({
      requestNumber: number,
      customerEmail: customer.user.email,
      hasFile: true,
    });
    await as(staff.cookie)
      .post(`/custom-requests/${id}/quote`, { price: '0' })
      .expect(400);
    const quoted = await as(staff.cookie)
      .post(`/custom-requests/${id}/quote`, {
        price: '30.00',
        note: 'Printed in PETG for strength',
      })
      .expect(200);
    const days =
      (Date.parse(quoted.body.quote.expiresAt) -
        Date.parse(quoted.body.quote.quotedAt)) /
      86_400_000;
    expect(days).toBeCloseTo(7, 3);

    const mine = await me.get(`/custom-requests/mine/${number}`).expect(200);
    expect(mine.body).toMatchObject({
      status: 'QUOTED',
      expired: false,
      quote: { price: '30.00', note: 'Printed in PETG for strength' },
    });

    // Accepting makes the order: one made-to-order line, so the deposit applies.
    const form = checkoutForm();
    const order = await me
      .post(`/custom-requests/mine/${number}/accept`, form)
      .expect(201);
    expect(order.body).toMatchObject({
      status: 'AWAITING_DEPOSIT',
      total: '30.00',
      depositRequired: '15.00',
    });
    // A repeated submit returns the same order; a new one can't accept twice.
    await me
      .post(`/custom-requests/mine/${number}/accept`, form)
      .expect(201, order.body);
    await me
      .post(`/custom-requests/mine/${number}/accept`, checkoutForm())
      .expect(409);

    const done = await me.get(`/custom-requests/mine/${number}`).expect(200);
    expect(done.body.status).toBe('ACCEPTED');
    expect(done.body.orderNumber).toBe(order.body.orderNumber);
    expect(done.body.history.map((h: { status: string }) => h.status)).toEqual([
      'SUBMITTED',
      'QUOTED',
      'ACCEPTED',
    ]);
    const history = await prisma.customRequestStatusHistory.findMany({
      where: { requestId: id },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((h) => h.changedByUserId)).toEqual([
      customer.user.id,
      staff.user.id,
      customer.user.id,
    ]);
    const staffOrder = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: order.body.orderNumber },
      include: { items: true, customRequest: true },
    });
    expect(staffOrder.customRequest?.id).toBe(id);
    expect(staffOrder.items[0]).toMatchObject({
      name: 'Custom: Shelf bracket',
      isCustom: true,
      productId: null,
    });
  });

  it('an expired quote cannot be accepted; staff can quote again', async () => {
    const customer = await signedInCustomer(app);
    const me = as(customer.cookie);
    const staff = await signedInAs(app, Role.STAFF);
    const { body } = await me
      .post('/custom-requests', {
        title: 'Name sign',
        description: 'A door sign with our family name.',
      })
      .expect(201);
    const row = await prisma.customRequest.findUniqueOrThrow({
      where: { requestNumber: body.requestNumber },
    });
    await as(staff.cookie)
      .post(`/custom-requests/${row.id}/quote`, { price: '12' })
      .expect(200);
    await prisma.customRequest.update({
      where: { id: row.id },
      data: {
        quotedAt: new Date(Date.now() - 9 * 86_400_000),
        quoteExpiresAt: new Date(Date.now() - 2 * 86_400_000),
      },
    });
    expect(
      (await me.get(`/custom-requests/mine/${body.requestNumber}`)).body
        .expired,
    ).toBe(true);
    const refused = await me
      .post(
        `/custom-requests/mine/${body.requestNumber}/accept`,
        checkoutForm(),
      )
      .expect(409);
    expect(refused.body.message).toMatch(/expired/);

    await as(staff.cookie)
      .post(`/custom-requests/${row.id}/quote`, { price: '11' })
      .expect(200);
    await me
      .post(
        `/custom-requests/mine/${body.requestNumber}/accept`,
        checkoutForm(),
      )
      .expect(201);
  });

  it('customers cancel before a quote and decline after; staff cancel with a reason', async () => {
    const customer = await signedInCustomer(app);
    const me = as(customer.cookie);
    const staff = await signedInAs(app, Role.STAFF);
    const make = async () =>
      (
        await me
          .post('/custom-requests', {
            title: 'Cable organiser',
            description: 'Something to tidy six cables under a desk.',
          })
          .expect(201)
      ).body.requestNumber as string;

    const first = await make();
    await me.post(`/custom-requests/mine/${first}/decline`).expect(400);
    const cancelled = await me
      .post(`/custom-requests/mine/${first}/cancel`, { note: 'Found one' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const second = await make();
    const id = (
      await prisma.customRequest.findUniqueOrThrow({
        where: { requestNumber: second },
      })
    ).id;
    await as(staff.cookie)
      .post(`/custom-requests/${id}/quote`, { price: '9.50' })
      .expect(200);
    await me.post(`/custom-requests/mine/${second}/cancel`).expect(400);
    const declined = await me
      .post(`/custom-requests/mine/${second}/decline`, { note: 'Too pricey' })
      .expect(200);
    expect(declined.body.status).toBe('DECLINED');
    expect(declined.body.history.at(-1)).toMatchObject({ note: 'Too pricey' });
    await as(staff.cookie)
      .post(`/custom-requests/${id}/quote`, { price: '8' })
      .expect(409);

    const third = await make();
    const thirdId = (
      await prisma.customRequest.findUniqueOrThrow({
        where: { requestNumber: third },
      })
    ).id;
    const closed = await as(staff.cookie)
      .post(`/custom-requests/${thirdId}/cancel`, {
        note: 'We cannot print flexible parts yet',
      })
      .expect(200);
    expect(closed.body.status).toBe('CANCELLED');
    await prisma.auditLog.findFirstOrThrow({
      where: { action: 'custom-request.cancel', targetId: thirdId },
    });
  });

  it("nobody reaches someone else's request; numbers and files are checked", async () => {
    const owner = await signedInCustomer(app);
    const { body } = await as(owner.cookie)
      .post('/custom-requests', {
        title: 'Lamp',
        description: 'A small reading lamp shade.',
      })
      .expect(201);
    const other = as((await signedInCustomer(app)).cookie);
    await other.get(`/custom-requests/mine/${body.requestNumber}`).expect(404);
    await other
      .post(`/custom-requests/mine/${body.requestNumber}/cancel`)
      .expect(404);
    await other.get('/custom-requests/mine/not-a-number').expect(404);
    await http().post('/custom-requests').set(CSRF).send({}).expect(401);

    // A file uploaded by someone else can't be attached.
    const theirFile = await as(owner.cookie)
      .upload(cubeStl(10), 'cube.stl')
      .expect(201);
    await other
      .post('/custom-requests', {
        title: 'Copy',
        description: 'Using a file that is not mine.',
        fileKey: theirFile.body.key,
      })
      .expect(400);
  });

  it("uploads follow the owner's size limit and the accepted types", async () => {
    const me = as((await signedInCustomer(app)).cookie);
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: { customUploadMaxMb: 1 },
    });
    const big = cubeStl(10);
    const twoMb = Buffer.concat([
      big.subarray(0, 80),
      Buffer.alloc(4),
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    const res = await me.upload(twoMb, 'big.stl').expect(400);
    expect(res.body.message).toMatch(/up to 1 MB/);
    await me.upload(Buffer.from('#!/bin/sh\necho hi'), 'run.sh').expect(400);

    // Photos are accepted too; they get no estimate.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const photo = await me.upload(png, 'sketch.png').expect(201);
    const estimate = await me
      .post('/custom-requests/estimate', { fileKey: photo.body.key })
      .expect(200);
    expect(estimate.body).toEqual({ estimate: null });
  });

  it('lists the materials a customer can ask for', async () => {
    const res = await http().get('/custom-requests/materials').expect(200);
    expect(res.body.map((m: { code: string }) => m.code)).toContain('PLA');
    expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'id', 'name']);
  });
});
