import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CurrenciesService } from '../src/currencies/currencies.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { cookiesFrom, createApp } from './create-app.js';
import {
  createProduct,
  CSRF,
  cookiePairs,
  signedInCustomer,
} from './commerce-helpers.js';
import { CART_COOKIE } from '../src/cart/cart-cookie.js';

// Checkout allows 5 attempts per minute per IP; this file makes exactly 5.
describe('Checkout (e2e)', () => {
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
    currency: 'LBP',
    delivery: true,
    city: 'Beirut',
    addressLine: 'Hamra St, Bldg 12, 3rd floor',
  };

  async function guestCartWith(productId: string, quantity: number) {
    const res = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId, quantity })
      .expect(201);
    return cookiePairs(res.headers['set-cookie']).join('; ');
  }

  it('browsing is open, but placing an order needs an account', async () => {
    const product = await createProduct(app);
    const jar = await guestCartWith(product.id, 1);
    // 1. A guest can fill a cart, but checkout answers 401 so the site asks them to sign in.
    await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', jar)
      .send({ ...deliveryForm, idempotencyKey: randomUUID() })
      .expect(401);
  });

  it('signed-in checkout: merges the guest cart, re-prices on the server, converts to LBP, is idempotent, remembers the phone', async () => {
    const product = await createProduct(app);
    const jar = await guestCartWith(product.id, 2);
    const { user, cookie } = await signedInCustomer(app);
    const both = `${jar}; ${cookie}`;
    const idempotencyKey = randomUUID();

    // 2. The browser cannot set its own total (unknown fields are rejected), so the only
    //    total is the server's: 2 × $13.91 + $5 delivery = $32.82.
    const res = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', both)
      .send({ ...deliveryForm, idempotencyKey })
      .expect(201);

    const lbp = await app.get(CurrenciesService).converterFor('LBP');
    expect(res.body).toEqual({
      orderNumber: expect.stringMatching(/^FG-\d{4}-\d{4,}$/),
      status: 'PENDING',
      paymentMethod: 'COD',
      total: '32.82',
      depositRequired: '0.00',
      currencyCode: 'LBP',
      exchangeRate: lbp.exchangeRate,
      totalInCurrency: lbp.convert('32.82'),
      depositInCurrency: '0',
    });

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.orderNumber },
      include: { items: true, statusHistory: true },
    });
    expect(order).toMatchObject({
      userId: user.id,
      city: 'Beirut',
      delivery: true,
    });
    expect(order.items).toEqual([
      expect.objectContaining({ productId: product.id, quantity: 2 }),
    ]);
    // The customer placed it, so they are the actor of the first history row.
    expect(order.statusHistory).toEqual([
      expect.objectContaining({ status: 'PENDING', changedByUserId: user.id }),
    ]);
    // The guest cart cookie is cleared; name and phone are kept for next time.
    expect(cookiesFrom(res.headers['set-cookie'])[CART_COOKIE]?.value).toBe('');
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      name: 'Rana Khoury',
      phone: '+961 70 123 456',
    });

    // 3. Same submit again (double click / retry) → the same order, not a second one.
    const again = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ ...deliveryForm, idempotencyKey })
      .expect(201);
    expect(again.body.orderNumber).toBe(res.body.orderNumber);
    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(1);
  });

  it('signed-in pickup of a custom product: 50% deposit, awaiting deposit', async () => {
    const product = await createProduct(app, { isCustom: true });
    const { user, cookie } = await signedInCustomer(app);
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ productId: product.id })
      .expect(201);

    // 4. Pickup: no address needed, no delivery fee. Paid in USD by money transfer.
    const res = await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({
        idempotencyKey: randomUUID(),
        name: 'Karim',
        phone: '03 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'AWAITING_DEPOSIT',
      total: '13.91',
      depositRequired: '6.96', // 50% of 13.91, rounded half up
      currencyCode: 'USD',
      totalInCurrency: '13.91',
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.orderNumber },
    });
    expect(order).toMatchObject({
      userId: user.id,
      delivery: false,
      city: null,
    });
  });

  it('refuses a checkout that tries to set its own total', async () => {
    const product = await createProduct(app);
    const { cookie } = await signedInCustomer(app);
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ productId: product.id })
      .expect(201);
    // 5. A forged total is rejected outright.
    await http()
      .post('/orders/checkout')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({
        ...deliveryForm,
        idempotencyKey: randomUUID(),
        total: '0.01',
      })
      .expect(400);
  });
});
