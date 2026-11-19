import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { HTTP } from '@forgea/types';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  createProduct,
  CSRF,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { studioDay } from '../src/common/studio-day.js';
import { createApp } from './create-app.js';

/** Two tabs, a double click, a retried request: what is recorded, is recorded once. */
describe('Double submits (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('one cart ordered from two tabs at once makes one order', async () => {
    const product = await createProduct(app);
    const { cookie } = await signedInCustomer(app);
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ productId: product.id, quantity: 2 })
      .expect(201);
    const secret = app
      .get(ConfigService)
      .getOrThrow<string>('INTERNAL_PROXY_SECRET');
    const checkout = (n: number) =>
      http()
        .post('/orders/checkout')
        .set(CSRF)
        .set('Cookie', cookie)
        .set(HTTP.PROXY_SECRET_HEADER, secret)
        .set(HTTP.FORWARDED_CLIENT_IP_HEADER, `10.77.0.${n}`)
        .send({
          // Each tab loaded the page: its own key.
          idempotencyKey: randomUUID(),
          name: 'Rana Khoury',
          phone: '70 123 456',
          paymentMethod: 'COD',
          delivery: false,
        });
    const [a, b] = await Promise.all([checkout(1), checkout(2)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('spools received twice by the same form are on the shelf once', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const pla = await prisma.material.findUniqueOrThrow({
      where: { code: 'PLA' },
    });
    const colour = `Twice ${randomUUID().slice(0, 6)}`;
    const requestKey = randomUUID();
    const receive = () =>
      http()
        .post('/stock/receipts')
        .set(CSRF)
        .set('Cookie', staff.cookie)
        .send({
          materialId: pla.id,
          colour,
          spools: 2,
          spoolGrams: 1000,
          pricePerSpool: '20.00',
          updateCost: false,
          requestKey,
        });
    const results = await Promise.all([receive(), receive()]);
    expect(results.map((r) => r.status)).toEqual([204, 204]);
    const item = await prisma.stockItem.findFirstOrThrow({
      where: { materialId: pla.id, colour },
      include: { movements: true },
    });
    expect(item.movements).toHaveLength(1);
    expect(item.movements[0]!.grams).toBe(2000);
  });

  it('two adds to the cart at once both count', async () => {
    const product = await createProduct(app);
    const { cookie } = await signedInCustomer(app);
    const add = () =>
      http()
        .post('/cart/items')
        .set(CSRF)
        .set('Cookie', cookie)
        .send({ productId: product.id, quantity: 1 });
    // The cart exists first, as it does after the first visit.
    await add().expect(201);
    await Promise.all([add(), add(), add()]);
    const cart = await http().get('/cart').set('Cookie', cookie).expect(200);
    expect(cart.body.lines[0].quantity).toBe(4);
  });

  it('a payment sent twice by the same form is recorded once', async () => {
    const staff = await signedInAs(app, Role.ADMIN);
    const customer = await signedInCustomer(app);
    const product = await createProduct(app, { isCustom: true });
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);
    const placed = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({
        idempotencyKey: randomUUID(),
        name: 'Rana Khoury',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
    });
    const invoice = (
      await http()
        .post(`/accounting/orders/${order.id}/deposit-invoice`)
        .set(CSRF)
        .set('Cookie', staff.cookie)
        .send({})
        .expect(201)
    ).body as { id: string; total: string };
    const requestKey = randomUUID();
    const half = (Number(invoice.total) / 2).toFixed(2);
    const pay = () =>
      http()
        .post('/accounting/payments')
        .set(CSRF)
        .set('Cookie', staff.cookie)
        .send({
          invoiceId: invoice.id,
          amount: half,
          method: 'BANK',
          date: studioDay(),
          requestKey,
        });
    const results = await Promise.all([pay(), pay()]);
    expect(results.every((r) => r.status < 300)).toBe(true);
    const listed = (
      await http()
        .get(`/accounting/orders/${order.id}/invoices`)
        .set('Cookie', staff.cookie)
        .expect(200)
    ).body as { id: string; residual: string }[];
    expect(listed.find((i) => i.id === invoice.id)!.residual).toBe(
      (Number(invoice.total) - Number(half)).toFixed(2),
    );
  });

  it('a payment and a credit note on one invoice at once: every payment is matched, the note made once', async () => {
    const staff = await signedInAs(app, Role.ADMIN);
    const customer = await signedInCustomer(app);
    const product = await createProduct(app, { isCustom: true });
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);
    const placed = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', customer.cookie)
      .send({
        idempotencyKey: randomUUID(),
        name: 'Rana Khoury',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
    });
    const invoice = (
      await http()
        .post(`/accounting/orders/${order.id}/deposit-invoice`)
        .set(CSRF)
        .set('Cookie', staff.cookie)
        .send({})
        .expect(201)
    ).body as { id: string; total: string };
    const credit = () =>
      http()
        .post(`/accounting/invoices/${invoice.id}/credit-note`)
        .set(CSRF)
        .set('Cookie', staff.cookie);
    const [paid, credited, again] = await Promise.all([
      http()
        .post('/accounting/payments')
        .set(CSRF)
        .set('Cookie', staff.cookie)
        .send({
          invoiceId: invoice.id,
          amount: (Number(invoice.total) / 2).toFixed(2),
          method: 'BANK',
          date: studioDay(),
          requestKey: randomUUID(),
        }),
      credit(),
      credit(),
    ]);
    // The second credit note is refused cleanly, never a server error.
    expect([credited.status, again.status].sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    // The payment came first and is matched, or after and was refused: never posted unmatched.
    expect([201, 400]).toContain(paid.status);
    const payments = await prisma.journalEntry.findMany({
      where: { orderId: order.id, type: 'PAYMENT' },
      include: { lines: { include: { asCredit: true } } },
    });
    for (const p of payments) {
      const matched = p.lines
        .flatMap((l) => l.asCredit)
        .reduce((n, m) => n + Number(m.amount), 0);
      expect(matched).toBeGreaterThan(0);
    }
  });

  it('two admins taking away each other’s admin role at once keep one admin', async () => {
    // A fresh pair, with every other admin switched off for the moment.
    const others = await prisma.user.findMany({
      where: { role: 'ADMIN', disabledAt: null },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { disabledAt: new Date() },
    });
    try {
      const a = await signedInAs(app, Role.ADMIN);
      const b = await signedInAs(app, Role.ADMIN);
      const demote = (by: string, id: string) =>
        http()
          .put(`/users/${id}/team`)
          .set(CSRF)
          .set('Cookie', by)
          .send({ role: 'STAFF', active: true });
      const results = await Promise.all([
        demote(a.cookie, b.user.id),
        demote(b.cookie, a.user.id),
      ]);
      expect(
        await prisma.user.count({
          where: { id: { in: [a.user.id, b.user.id] }, role: 'ADMIN' },
        }),
      ).toBe(1);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { disabledAt: null },
      });
    }
  });
});
