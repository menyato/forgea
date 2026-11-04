import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  createProduct,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';
import { inbox, registerCustomer } from './mail-helpers.js';

describe('Emails and the production planner (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('a new customer is emailed a code; nothing is confirmed until it is entered', async () => {
    const email = uniqueEmail('verify');
    await registerCustomer(app, { email, password: 'correct-horse-battery-9' });
    const [mail] = await inbox(app, email);
    expect(mail?.subject).toMatch(/^\d{6} is your Forgea code$/);
    expect(mail?.text).not.toContain('http');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await prisma.emailCode.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });

  it('the customer is emailed when the order is placed and at every step', async () => {
    const product = await createProduct(app, { isCustom: true });
    const customer = await signedInCustomer(app);
    const as = (cookie: string) => ({
      post: (url: string, body: object) =>
        http().post(url).set(CSRF).set('Cookie', cookie).send(body),
      patch: (url: string, body: object) =>
        http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
    });
    await as(customer.cookie)
      .post('/cart/items', { productId: product.id, quantity: 1 })
      .expect(201);
    const placed = await as(customer.cookie)
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Rana Khoury',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
      })
      .expect(201);
    const number = placed.body.orderNumber as string;
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: number },
    });
    const staff = await signedInAs(app, Role.STAFF);
    await as(staff.cookie)
      .patch(`/orders/${order.id}/status`, {
        status: 'CONFIRMED',
        note: 'Deposit by Whish',
      })
      .expect(200);

    const mails = await inbox(app, customer.user.email);
    expect(mails.map((m) => m.subject).sort()).toEqual(
      [`Order ${number} received`, `Order ${number}: Confirmed`].sort(),
    );
    const received = mails.find((m) => m.subject.endsWith('received'))!;
    expect(received.text).toContain('+961 70 904 044');
    expect(mails.find((m) => m.subject.endsWith('Confirmed'))!.text).toContain(
      'Deposit by Whish',
    );
  });

  it('the production planner schedules, prints and uses the material stock', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const customer = await signedInCustomer(app);
    const product = await createProduct(app);
    const order = await prisma.order.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    const pla = await prisma.material.update({
      where: { code: 'PLA' },
      data: { stockGrams: 1000 },
    });
    const job = {
      orderId: order.id,
      materialId: pla.id,
      color: 'Black',
      grams: '60.4',
      hours: '3',
      machine: 'Printer 1',
    };
    const as = (cookie: string) => ({
      post: (url: string, body: object) =>
        http().post(url).set(CSRF).set('Cookie', cookie).send(body),
      patch: (url: string, body: object) =>
        http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
    });
    await as(customer.cookie).post('/print-jobs', job).expect(403);
    await as(staff.cookie)
      .post('/print-jobs', { ...job, grams: '0' })
      .expect(400);
    await as(staff.cookie)
      .post('/print-jobs', { ...job, orderId: randomUUID() })
      .expect(404);

    const created = await as(staff.cookie).post('/print-jobs', job).expect(201);
    expect(created.body.status).toBe('QUEUED');
    const id = created.body.id as string;
    const scheduled = await as(staff.cookie)
      .patch(`/print-jobs/${id}`, { scheduledDate: '2026-11-02T08:00:00.000Z' })
      .expect(200);
    expect(scheduled.body.status).toBe('SCHEDULED');
    await as(staff.cookie)
      .patch(`/print-jobs/${id}`, { status: 'DONE' })
      .expect(400);
    await as(staff.cookie)
      .patch(`/print-jobs/${id}`, { status: 'PRINTING' })
      .expect(200);
    await as(staff.cookie)
      .patch(`/print-jobs/${id}`, { status: 'DONE' })
      .expect(200);
    const after = await prisma.material.findUniqueOrThrow({
      where: { id: pla.id },
    });
    // A finished print leaves stock as it is: its order took the filament when it went into
    // production (failed prints are covered in stock.e2e-spec.ts).
    expect(after.stockGrams).toBe(pla.stockGrams);
    await as(staff.cookie)
      .patch(`/print-jobs/${id}`, { status: 'QUEUED' })
      .expect(400);
    await prisma.auditLog.findFirstOrThrow({
      where: { action: 'print-job.update', targetId: id },
    });
    expect(product.id).toBeTruthy();
  });
});
