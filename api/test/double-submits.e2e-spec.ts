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
});
