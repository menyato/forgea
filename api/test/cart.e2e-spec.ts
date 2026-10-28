import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CART_COOKIE } from '../src/cart/cart-cookie.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { cookiesFrom, createApp } from './create-app.js';
import {
  createProduct,
  CSRF,
  cookiePairs,
  signedInCustomer,
} from './commerce-helpers.js';

describe('Cart (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('gives a guest a signed, httpOnly cart cookie and prices the lines', async () => {
    const product = await createProduct(app);
    const res = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: product.id, quantity: 2 })
      .expect(201);

    expect(res.body).toEqual({
      itemCount: 2,
      lines: [
        expect.objectContaining({
          productId: product.id,
          quantity: 2,
          unitPrice: '13.91',
          isCustom: false,
        }),
      ],
    });
    const cookie = cookiesFrom(res.headers['set-cookie'])[CART_COOKIE];
    expect(cookie?.value).toMatch(/^s:/); // signed by cookie-parser
    expect(cookie?.attrs).toEqual(
      expect.arrayContaining(['httponly', 'secure', 'samesite=lax']),
    );
  });

  it('adds to an existing line, changes and removes it', async () => {
    const product = await createProduct(app);
    const first = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: product.id })
      .expect(201);
    const jar = cookiePairs(first.headers['set-cookie']).join('; ');

    const again = await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', jar)
      .send({ productId: product.id, quantity: 4 })
      .expect(201);
    expect(again.body.lines[0].quantity).toBe(5);
    const lineId: string = again.body.lines[0].id;

    const changed = await http()
      .patch(`/cart/items/${lineId}`)
      .set(CSRF)
      .set('Cookie', jar)
      .send({ quantity: 2 })
      .expect(200);
    expect(changed.body.itemCount).toBe(2);

    const removed = await http()
      .delete(`/cart/items/${lineId}`)
      .set(CSRF)
      .set('Cookie', jar)
      .expect(200);
    expect(removed.body).toEqual({ lines: [], itemCount: 0 });
  });

  it('ignores a tampered cart cookie', async () => {
    const product = await createProduct(app);
    const res = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: product.id })
      .expect(201);
    const cartId = await prisma.cart.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    // An unsigned cookie naming a real cart must not give access to it.
    const forged = await http()
      .get('/cart')
      .set('Cookie', `${CART_COOKIE}=${cartId.id}`)
      .expect(200);
    expect(forged.body).toEqual({ lines: [], itemCount: 0 });
    expect(cookiePairs(res.headers['set-cookie'])).toHaveLength(1);
  });

  it('refuses inactive or unknown products and invalid quantities', async () => {
    const product = await createProduct(app);
    await prisma.product.update({
      where: { id: product.id },
      data: { active: false },
    });
    await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: product.id })
      .expect(404);
    await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: '019a2000-0000-7000-8000-000000000999' })
      .expect(404);
    await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: product.id, quantity: 0 })
      .expect(400);
  });

  it("merges a guest cart into the customer's cart when they sign in", async () => {
    const shared = await createProduct(app);
    const guestOnly = await createProduct(app);
    const { user, cookie } = await signedInCustomer(app);

    // Signed-in cart: 1 × shared.
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ productId: shared.id })
      .expect(201);
    // Guest cart (before signing in): 2 × shared, 1 × guestOnly.
    const g = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: shared.id, quantity: 2 })
      .expect(201);
    const guestJar = cookiePairs(g.headers['set-cookie']).join('; ');
    await http()
      .post('/cart/items')
      .set(CSRF)
      .set('Cookie', guestJar)
      .send({ productId: guestOnly.id })
      .expect(201);

    // First request with both the session and the guest cookie merges and clears the cookie.
    const merged = await http()
      .get('/cart')
      .set('Cookie', `${cookie}; ${guestJar}`)
      .expect(200);
    const qty = Object.fromEntries(
      merged.body.lines.map((l: { productId: string; quantity: number }) => [
        l.productId,
        l.quantity,
      ]),
    );
    expect(qty).toEqual({ [shared.id]: 3, [guestOnly.id]: 1 });
    expect(cookiesFrom(merged.headers['set-cookie'])[CART_COOKIE]?.value).toBe(
      '',
    );
    expect(await prisma.cart.count({ where: { userId: user.id } })).toBe(1);
  });

  it('hands a guest cart over once when a page reads the cart several times at once', async () => {
    const product = await createProduct(app);
    const { cookie } = await signedInCustomer(app);
    const g = await http()
      .post('/cart/items')
      .set(CSRF)
      .send({ productId: product.id, quantity: 2 })
      .expect(201);
    const jar = `${cookie}; ${cookiePairs(g.headers['set-cookie']).join('; ')}`;

    // The root and page loaders run in parallel right after sign-in.
    const reads = await Promise.all(
      Array.from({ length: 4 }, () =>
        http().get('/cart').set('Cookie', jar).expect(200),
      ),
    );
    for (const r of reads) {
      expect(r.body.lines.map((l: { quantity: number }) => l.quantity)).toEqual(
        [2],
      );
    }
  });
});
