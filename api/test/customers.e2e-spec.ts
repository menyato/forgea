import type { NestExpressApplication } from '@nestjs/platform-express';
import type { CustomerDetail, CustomerList } from '@forgea/types';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs, signedInCustomer } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';
import { registerCustomer } from './mail-helpers.js';

/** Customers as people: with an account or known only by email, and all they did. */
describe('Customers (e2e)', () => {
  let app: NestExpressApplication;
  let staff: Awaited<ReturnType<typeof signedInAs>>;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  const find = async (q: string, kind?: string) =>
    (
      await as(staff.cookie)
        .get(
          `/customers?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`,
        )
        .expect(200)
    ).body as CustomerList;

  beforeAll(async () => {
    app = await createApp();
    staff = await signedInAs(app, Role.STAFF);
  });
  afterAll(() => app.close());

  it('someone sent a quotation has no account until it is confirmed; then their order counts', async () => {
    const email = uniqueEmail('people');
    const q = (
      await as(staff.cookie)
        .post('/quotations', {
          customerEmail: email,
          validUntil: '2099-12-31',
          customerName: 'Hiba Guest',
          phone: '70 777 888',
          paymentMethod: 'COD',
          delivery: false,
          lines: [{ description: 'Planter', quantity: 2, unitPrice: '15.00' }],
        })
        .expect(201)
    ).body as { id: string; number: string };
    await as(staff.cookie)
      .post('/leads/manual', {
        name: 'Hiba Guest',
        email,
        message: 'Two planters for the balcony.',
      })
      .expect(201);

    const guest = await find(email, 'guest');
    expect(guest.items).toEqual([
      expect.objectContaining({
        email,
        name: 'Hiba Guest',
        phone: '70 777 888',
        account: null,
        orders: 0,
        spent: '0.00',
        quotations: 1,
        leads: 1,
      }),
    ]);
    expect((await find(email, 'account')).items).toEqual([]);
    expect(guest.guestCarts).toBeGreaterThanOrEqual(0);

    // Confirmed by the studio: an account is made for the address, and the order is theirs.
    const placed = await as(staff.cookie)
      .post(`/quotations/${q.id}/confirm`)
      .expect(200);
    const [customer] = (await find(email, 'account')).items;
    expect(customer).toMatchObject({
      account: { signIn: [], confirmed: false },
      orders: 1,
      spent: '30.00',
    });

    const one = (
      await as(staff.cookie)
        .get(`/customers/one?email=${encodeURIComponent(email.toUpperCase())}`)
        .expect(200)
    ).body as CustomerDetail;
    expect(one.history.orders).toEqual([
      expect.objectContaining({
        number: placed.body.orderNumber,
        total: '30.00',
      }),
    ]);
    expect(one.history.quotations).toEqual([
      expect.objectContaining({ number: q.number, status: 'CONFIRMED' }),
    ]);
    expect(one.history.leads).toEqual([
      expect.objectContaining({ name: 'Hiba Guest', state: 'open' }),
    ]);
  });

  it('a shop customer is listed with how they sign in; customers may not look', async () => {
    const shopper = await signedInCustomer(app);
    const [me] = (await find(shopper.user.email)).items;
    expect(me).toMatchObject({ account: { id: shopper.user.id } });
    await as(staff.cookie)
      .get('/customers/one?email=nobody-at-all%40example.com')
      .expect(404);
    await as(staff.cookie).get('/customers/one?email=not-an-email').expect(400);
    await as(shopper.cookie).get('/customers').expect(403);
  });

  it('each sign-in is tracked: when, on what, still signed in; the Overview counts customers', async () => {
    const email = uniqueEmail('tracked');
    await registerCustomer(app, { email, password: 'correct-horse-battery-9' });
    const one = (
      await as(staff.cookie)
        .get(`/customers/one?email=${encodeURIComponent(email)}`)
        .expect(200)
    ).body as CustomerDetail;
    expect(one.lastSeen).not.toBeNull();
    expect(one.signIns).toEqual([
      expect.objectContaining({ active: true, device: expect.any(String) }),
    ]);
    const summary = (
      await as(staff.cookie).get('/customers/summary').expect(200)
    ).body as Record<string, number>;
    expect(summary['accounts']).toBeGreaterThanOrEqual(1);
    expect(summary['newThisWeek']).toBeGreaterThanOrEqual(1);
    expect(summary['seenThisWeek']).toBeGreaterThanOrEqual(1);
    expect(summary).toHaveProperty('withoutAccount');
    expect(summary).toHaveProperty('guestCarts');
  });
});
