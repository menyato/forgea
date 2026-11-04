import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';
import { inbox, registerCustomer } from './mail-helpers.js';

/** Quotations for anyone with an email address, sent as a full document with a private link. */
describe('Quotations by email (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
  });

  const form = (customerEmail: string) => ({
    customerEmail,
    validUntil: '2099-12-31',
    customerName: 'Nour Saleh',
    phone: '70 555 666',
    paymentMethod: 'TRANSFER',
    delivery: false,
    note: 'Printed in matte black PETG.',
    lines: [
      {
        description: 'Display stand',
        quantity: 2,
        unitPrice: '25.00',
        isCustom: true,
        sizeXcm: '30',
        sizeYcm: '12.5',
        sizeZcm: '18',
      },
      { description: 'Design work', quantity: 1, unitPrice: '40.00' },
    ],
  });

  /** The private link in the last quotation email to this address. */
  async function linkIn(to: string) {
    const mails = await inbox(app, to);
    const mail = mails.at(-1);
    const token = mail && /\/q\/([\w.-]+)/.exec(mail.text)?.[1];
    if (!mail || !token) throw new Error(`no quotation email to ${to}`);
    return { mail, token: decodeURIComponent(token) };
  }

  /** Signs up (or in) as a customer with this address: a session cookie. */
  async function customerCookie(email: string) {
    return registerCustomer(app, {
      email,
      password: 'correct-horse-battery-9',
    });
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: {
        quotationEmailSubject: null,
        quotationEmailIntro: null,
        quotationEmailClosing: null,
      },
    });
    await app.close();
  });

  it('someone without an account gets the full quotation by email, opens it and accepts it after signing up', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const email = uniqueEmail('guest');
    const created = await as(staff.cookie)
      .post('/quotations', form(email))
      .expect(201);
    expect(created.body.customer).toEqual({
      id: null,
      email,
      name: 'Nour Saleh',
    });
    expect(created.body.lines[0].size).toEqual({ x: '30', y: '12.5', z: '18' });
    expect(created.body.total).toBe('90.00');

    await as(staff.cookie)
      .post(`/quotations/${created.body.id}/send`)
      .expect(200);
    const { mail, token } = await linkIn(email);
    expect(mail.subject).toBe(
      `Your quotation ${created.body.number} from Forgea`,
    );
    expect(mail.text).toContain('Dear Nour Saleh,');
    expect(mail.text).toContain(
      'Display stand, 30 × 12.5 × 18 cm: 2 × $25.00 = $50.00',
    );
    expect(mail.text).toContain('Total: $90.00');
    expect(mail.text).toContain('Printed in matte black PETG.');

    // The link opens it with no account at all.
    const seen = await http().get(`/quotations/link/${token}`).expect(200);
    expect(seen.body.number).toBe(created.body.number);
    // A tampered or made-up link opens nothing.
    await http().get(`/quotations/link/${token}x`).expect(404);
    await http().get('/quotations/link/not-a-token').expect(404);

    // Accepting needs an account, and it must be the address it was sent to.
    await http().post(`/quotations/link/${token}/accept`).set(CSRF).expect(401);
    const stranger = await customerCookie(uniqueEmail('stranger'));
    const refused = await http()
      .post(`/quotations/link/${token}/accept`)
      .set(CSRF)
      .set('Cookie', stranger)
      .expect(409);
    expect(refused.body.message).toContain(email);

    const owner = await customerCookie(email);
    const placed = await http()
      .post(`/quotations/link/${token}/accept`)
      .set(CSRF)
      .set('Cookie', owner)
      .expect(200);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
      include: { items: true, user: true },
    });
    expect(order.user.email).toBe(email);
    // The order line keeps the agreed size.
    expect(order.items.map((i) => i.name)).toContain(
      'Display stand (30 × 12.5 × 18 cm)',
    );
    // Now it is theirs, also on their own quotation page.
    await http()
      .get(`/quotations/mine/${created.body.number}`)
      .set('Cookie', owner)
      .expect(200);
  });

  it('the owner words the email; staff confirming for someone without an account makes one', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const staff = await signedInAs(app, Role.STAFF);
    await as(staff.cookie)
      .put('/store-settings/quotation-email', { subject: 'x' })
      .expect(403);
    await as(admin.cookie)
      .put('/store-settings/quotation-email', {
        subject: 'Forgea — {number} for {name}',
        intro: 'Hello {name}, here it is: {total} until {validUntil}.',
        closing: '',
      })
      .expect(200);
    const saved = (
      await as(admin.cookie).get('/store-settings/quotation-email').expect(200)
    ).body;
    expect(saved).toEqual({
      subject: 'Forgea — {number} for {name}',
      intro: 'Hello {name}, here it is: {total} until {validUntil}.',
      closing: null,
    });

    const email = uniqueEmail('phone');
    const q = (
      await as(staff.cookie).post('/quotations', form(email)).expect(201)
    ).body;
    await as(staff.cookie).post(`/quotations/${q.id}/send`).expect(200);
    const { mail } = await linkIn(email);
    expect(mail.subject).toBe(`Forgea — ${q.number} for Nour Saleh`);
    expect(mail.text).toContain(
      'Hello Nour Saleh, here it is: $90.00 until 31 December 2099.',
    );
    // An empty closing falls back to the standard words.
    expect(mail.text).toContain('Kind regards,');

    // They said yes on the phone: the order needs an account, so one is made for the address.
    await as(staff.cookie).post(`/quotations/${q.id}/confirm`).expect(200);
    const account = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(account).toMatchObject({
      role: Role.CUSTOMER,
      passwordHash: null,
      name: 'Nour Saleh',
    });
  });

  it('editing the address retires the old link; sizes are all three or none; team addresses refused', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const first = uniqueEmail('first');
    const q = (
      await as(staff.cookie).post('/quotations', form(first)).expect(201)
    ).body;
    await as(staff.cookie).post(`/quotations/${q.id}/send`).expect(200);
    const { token } = await linkIn(first);
    await http().get(`/quotations/link/${token}`).expect(200);

    await as(staff.cookie)
      .put(`/quotations/${q.id}`, form(uniqueEmail('second')))
      .expect(200);
    await http().get(`/quotations/link/${token}`).expect(404);

    /** The form with the first line changed. */
    const withFirstLine = (change: Record<string, string | undefined>) => {
      const f = form(uniqueEmail('size'));
      return {
        ...f,
        lines: [{ ...f.lines[0], ...change }, ...f.lines.slice(1)],
      };
    };
    const res = await as(staff.cookie)
      .post('/quotations', withFirstLine({ sizeZcm: undefined }))
      .expect(400);
    expect(res.body.message).toMatch(/all three sizes/);
    await as(staff.cookie)
      .post('/quotations', withFirstLine({ sizeXcm: '0' }))
      .expect(400);
    await as(staff.cookie)
      .post('/quotations', form(staff.user.email))
      .expect(400);
  });

  it('the dashboard tabs get their numbers; a lead stops being new once opened', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const counts = (
      await as(staff.cookie).get('/quotations/counts').expect(200)
    ).body;
    expect(counts.SENT).toBeGreaterThan(0);
    await as(staff.cookie).get('/orders/counts').expect(200);
    await as(staff.cookie).get('/custom-requests/counts').expect(200);
    await as((await signedInAs(app, Role.DESIGNER)).cookie)
      .get('/orders/counts')
      .expect(403);

    await http()
      .post('/leads')
      .set(CSRF)
      .send({
        name: 'New visitor',
        email: uniqueEmail('lead'),
        message: `A small sign for the shop ${randomUUID()}`,
      })
      .expect(201);
    const before = (await as(staff.cookie).get('/leads/counts').expect(200))
      .body.unopened as number;
    expect(before).toBeGreaterThan(0);
    const fresh = (
      await as(staff.cookie).get('/leads?unopened=true&limit=100').expect(200)
    ).body.items as { id: string; isNew: boolean }[];
    expect(fresh.every((l) => l.isNew)).toBe(true);
    await as(staff.cookie).get(`/leads/${fresh[0]!.id}`).expect(200);
    expect(
      (await as(staff.cookie).get('/leads/counts').expect(200)).body.unopened,
    ).toBe(before - 1);

    const pair = (
      await as(staff.cookie)
        .get('/orders?statuses=PENDING,AWAITING_DEPOSIT&limit=100')
        .expect(200)
    ).body.items as { status: string }[];
    expect(
      pair.every((o) => ['PENDING', 'AWAITING_DEPOSIT'].includes(o.status)),
    ).toBe(true);
    await as(staff.cookie).get('/orders?statuses=NOPE').expect(400);
  });
});
