import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { CartView, CurrentFreeOffer, FreeOfferView } from '@forgea/types';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  createProduct,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';

/**
 * A free piece for a limited time: the owner sets it up, the shop shows it, a customer claims
 * it (one line, one piece, priced 0), the order counts it, and it is never given twice to one
 * customer nor past its number, nor before it starts or after it ends.
 */
describe('Free offers (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object = {}) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object = {}) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  const hour = 3_600_000;
  const order = (cookie: string) =>
    as(cookie).post('/orders/checkout', {
      idempotencyKey: randomUUID(),
      name: 'Rana Khoury',
      phone: '70 123 456',
      paymentMethod: 'COD',
      delivery: false,
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await signedInAs(app, Role.ADMIN);
    // Offers from other runs must not be the one the shop shows.
    await prisma.freeOffer.updateMany({ data: { active: false } });
  });
  afterAll(() => app.close());

  it('the owner sets one up; claimed, it costs nothing, once per customer, up to its number', async () => {
    const product = await createProduct(app);
    const dto = {
      productId: product.id,
      title: 'Your free test piece',
      description: 'One per customer, this week only.',
      startsAt: new Date(Date.now() - hour).toISOString(),
      endsAt: new Date(Date.now() + 24 * hour).toISOString(),
      maxClaims: 2,
      active: true,
    };
    // Only the team with the permission, and an end after the start.
    const customer = await signedInCustomer(app);
    await as(customer.cookie).post('/offers', dto).expect(403);
    await as(admin.cookie)
      .post('/offers', { ...dto, endsAt: dto.startsAt })
      .expect(400);
    const offer = (await as(admin.cookie).post('/offers', dto).expect(201))
      .body as FreeOfferView;
    expect(offer).toMatchObject({ claimed: 0, maxClaims: 2 });

    // The shop sees it running, with how many are left.
    const current = (await http().get('/offers/current').expect(200))
      .body as CurrentFreeOffer;
    expect(current).toMatchObject({ id: offer.id, left: 2 });
    expect(current.product.slug).toBe(product.slug);

    // Claimed: its own line, one piece at 0, beside the same piece bought.
    await as(customer.cookie)
      .post('/cart/items', { productId: product.id, quantity: 1 })
      .expect(201);
    let cart = (
      await as(customer.cookie)
        .post('/cart/items', {
          productId: product.id,
          quantity: 3,
          freeOfferId: offer.id,
        })
        .expect(201)
    ).body as CartView;
    const free = cart.lines.find((l) => l.freeOfferId === offer.id)!;
    expect(free).toMatchObject({ quantity: 1, unitPrice: '0.00' });
    expect(cart.lines.find((l) => !l.freeOfferId)!.unitPrice).not.toBe('0.00');
    // It stays one piece.
    await as(customer.cookie)
      .patch(`/cart/items/${free.id}`, { quantity: 2 })
      .expect(404);
    // Another product can't be claimed under it.
    const other = await createProduct(app);
    await as(customer.cookie)
      .post('/cart/items', { productId: other.id, freeOfferId: offer.id })
      .expect(400);
    await as(customer.cookie).post(`/cart/items`, {}).expect(400);
    cart = (await as(customer.cookie).get('/cart').expect(200))
      .body as CartView;

    const placed = await order(customer.cookie).expect(201);
    const line = await prisma.orderItem.findFirstOrThrow({
      where: {
        order: { orderNumber: placed.body.orderNumber },
        freeOfferId: offer.id,
      },
    });
    expect(line.unitPrice.toString()).toBe('0');
    expect(
      (
        (await as(admin.cookie).get(`/offers/${offer.id}`).expect(200))
          .body as FreeOfferView
      ).claimed,
    ).toBe(1);

    // The same customer can't claim it twice: refused when ordering again.
    await as(customer.cookie)
      .post('/cart/items', { productId: product.id, freeOfferId: offer.id })
      .expect(201);
    const again = await order(customer.cookie).expect(409);
    expect(again.body.message).toMatch(/already claimed/);
    await prisma.cartItem.deleteMany({
      where: { cart: { userId: customer.user.id } },
    });

    // A second customer takes the last one; a third finds them all claimed.
    const second = await signedInCustomer(app);
    await as(second.cookie)
      .post('/cart/items', { productId: product.id, freeOfferId: offer.id })
      .expect(201);
    await order(second.cookie).expect(201);
    expect((await http().get('/offers/current').expect(200)).body).toEqual({});
    const third = await signedInCustomer(app);
    await as(third.cookie)
      .post('/cart/items', { productId: product.id, freeOfferId: offer.id })
      .expect(400);
  });

  it('an offer not started, ended or switched off gives nothing, and a cart line claimed earlier pays its price', async () => {
    const product = await createProduct(app);
    const later = (
      await as(admin.cookie)
        .post('/offers', {
          productId: product.id,
          title: 'Next week',
          startsAt: new Date(Date.now() + 24 * hour).toISOString(),
          endsAt: new Date(Date.now() + 48 * hour).toISOString(),
          active: true,
        })
        .expect(201)
    ).body as FreeOfferView;
    const customer = await signedInCustomer(app);
    const refused = await as(customer.cookie)
      .post('/cart/items', { productId: product.id, freeOfferId: later.id })
      .expect(400);
    expect(refused.body.message).toMatch(/not started/);

    const now = (
      await as(admin.cookie)
        .post('/offers', {
          productId: product.id,
          title: 'Today',
          startsAt: new Date(Date.now() - hour).toISOString(),
          endsAt: new Date(Date.now() + hour).toISOString(),
          active: true,
        })
        .expect(201)
    ).body as FreeOfferView;
    let cart = (
      await as(customer.cookie)
        .post('/cart/items', { productId: product.id, freeOfferId: now.id })
        .expect(201)
    ).body as CartView;
    expect(cart.lines[0]!.unitPrice).toBe('0.00');
    // The owner switches it off: the line is priced as usual, and the order isn't free.
    await as(admin.cookie)
      .put(`/offers/${now.id}`, {
        productId: product.id,
        title: 'Today',
        startsAt: now.startsAt,
        endsAt: now.endsAt,
        active: false,
      })
      .expect(200);
    cart = (await as(customer.cookie).get('/cart').expect(200))
      .body as CartView;
    expect(cart.lines[0]!.unitPrice).not.toBe('0.00');
    const placed = await order(customer.cookie).expect(201);
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { order: { orderNumber: placed.body.orderNumber } },
    });
    expect(line.freeOfferId).toBeNull();
    expect(Number(line.unitPrice)).toBeGreaterThan(0);
  });
});
