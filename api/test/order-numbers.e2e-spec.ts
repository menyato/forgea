import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createApp } from './create-app.js';
import { createProduct, CSRF, signedInCustomer } from './commerce-helpers.js';

// Its own file: checkout allows 5 attempts a minute, and checkout.e2e-spec uses them all.
describe('Order numbers (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const deliveryForm = {
    name: 'Rana Khoury',
    phone: '+961 70 123 456',
    paymentMethod: 'COD',
    delivery: false,
  };

  it('order numbers run on by year, and catch up when the counter is behind (a restore)', async () => {
    const product = await createProduct(app);
    const { cookie } = await signedInCustomer(app);
    const checkout = async () => {
      await http()
        .post('/cart/items')
        .set(CSRF)
        .set('Cookie', cookie)
        .send({ productId: product.id, quantity: 1 })
        .expect(201);
      const res = await http()
        .post('/orders/checkout')
        .set(CSRF)
        .set('Cookie', cookie)
        .send({ ...deliveryForm, idempotencyKey: randomUUID() })
        .expect(201);
      return res.body.orderNumber as string;
    };
    const count = (n: string) => Number(n.split('-')[2]);
    const first = await checkout();
    // As if a backup from before that order were restored: the counter forgets it.
    await prisma.orderSequence.update({
      where: { year: Number(first.split('-')[1]) },
      data: { last: count(first) - 1 },
    });
    const next = await checkout();
    expect(count(next)).toBeGreaterThan(count(first));
  });
});
