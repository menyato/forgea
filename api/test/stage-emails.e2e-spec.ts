import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs, signedInCustomer } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';
import { inbox } from './mail-helpers.js';

const STUDIO = 'studio-e2e@forgea-lab.com';

/**
 * Every step of a custom request, a quotation and an order is emailed to both sides: the
 * customer (what it means for them) and the studio (what happened, with a dashboard link).
 */
describe('Stage emails to the customer and the studio (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });
  const subjects = async (to: string) =>
    (await inbox(app, to)).map((m) => m.subject);
  /** Studio alerts about this one thing (other tests alert the same address). */
  const studioAbout = async (needle: string) =>
    (await subjects(STUDIO)).filter((s) => s.includes(needle));

  beforeAll(async () => {
    process.env['STUDIO_NOTIFY_EMAIL'] = STUDIO;
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    delete process.env['STUDIO_NOTIFY_EMAIL'];
    await app.close();
  });

  it('a custom request: received, quoted, declined', async () => {
    const customer = await signedInCustomer(app);
    const staff = await signedInAs(app, Role.STAFF);
    const number = (
      await as(customer.cookie)
        .post('/custom-requests', {
          title: 'Lamp shade',
          description: 'A shade for an E27 bulb, 20 cm across.',
        })
        .expect(201)
    ).body.requestNumber as string;
    const { id } = await prisma.customRequest.findUniqueOrThrow({
      where: { requestNumber: number },
    });
    await as(staff.cookie)
      .post(`/custom-requests/${id}/quote`, { price: '18.00' })
      .expect(200);
    await as(customer.cookie)
      .post(`/custom-requests/mine/${number}/decline`, { note: 'Too pricey' })
      .expect(200);

    expect(await subjects(customer.user.email)).toEqual([
      '"Lamp shade": Waiting for a quote',
      'Your quote for "Lamp shade"',
      '"Lamp shade": Declined',
    ]);
    expect(await studioAbout(number)).toEqual([
      `New custom request ${number}: Lamp shade`,
      `Quote sent for ${number}: Lamp shade`,
      `${number}: the customer declined the quote`,
    ]);
  });

  it('quotations: sent, declined, withdrawn; once accepted, every order step', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const email = uniqueEmail('stages');
    const write = async () =>
      (
        await as(staff.cookie)
          .post('/quotations', {
            customerEmail: email,
            validUntil: '2099-12-31',
            customerName: 'Rana Stages',
            phone: '70 444 555',
            paymentMethod: 'COD',
            delivery: false,
            lines: [
              { description: 'Coasters', quantity: 4, unitPrice: '3.00' },
            ],
          })
          .expect(201)
      ).body as { id: string; number: string };

    const declined = await write();
    await as(staff.cookie).post(`/quotations/${declined.id}/send`).expect(200);
    const link = (await inbox(app, email)).at(-1)!.text;
    const token = decodeURIComponent(/\/q\/([\w.-]+)/.exec(link)![1]!);
    await http()
      .post(`/quotations/link/${token}/decline`)
      .set(CSRF)
      .send({})
      .expect(200);

    const withdrawn = await write();
    await as(staff.cookie).post(`/quotations/${withdrawn.id}/send`).expect(200);
    await as(staff.cookie)
      .post(`/quotations/${withdrawn.id}/cancel`, { body: 'Prices changed' })
      .expect(200);

    const accepted = await write();
    const placed = await as(staff.cookie)
      .post(`/quotations/${accepted.id}/confirm`)
      .expect(200);
    const orderNumber = placed.body.orderNumber as string;
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
    });
    await as(staff.cookie)
      .patch(`/orders/${order.id}/status`, { status: 'CONFIRMED' })
      .expect(200);

    const mine = await subjects(email);
    expect(mine).toEqual(
      expect.arrayContaining([
        `You declined quotation ${declined.number}`,
        `Quotation ${withdrawn.number} was withdrawn`,
        expect.stringMatching(new RegExp(`^Order ${orderNumber}: `)),
      ]),
    );
    expect(await studioAbout(declined.number)).toEqual([
      `Quotation ${declined.number} sent`,
      `Quotation ${declined.number} declined`,
    ]);
    expect(await studioAbout(withdrawn.number)).toEqual([
      `Quotation ${withdrawn.number} sent`,
      `Quotation ${withdrawn.number} cancelled`,
    ]);
    expect(await studioAbout(orderNumber)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^New order ${orderNumber}`)),
        expect.stringMatching(new RegExp(`^Order ${orderNumber}: `)),
      ]),
    );
  });
});
