import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AccessTokenService } from '../src/authorization/access-token.service.js';
import { ACCESS_COOKIE } from '../src/authorization/auth-cookies.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';

const SEEDED = {
  transferPhone: '+961 70 904 044',
  transferInstructions: null,
  whatsappPhone: '+961 70 904 044',
};
/** The owner's decisions of 2026-10-27, the migration's starting values. */
const RULES = {
  quoteValidityDays: 7,
  depositRefundable: true,
  customUploadMaxMb: 50,
  estimateSolidityPercent: 40,
  estimateSpreadPercent: 20,
  autoQuoteSlicedFiles: true,
};

describe('Store settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const cookieFor = async (role: Role) => {
    const user = await prisma.user.create({
      data: { email: uniqueEmail(role.toLowerCase()), role },
    });
    const token = await app.get(AccessTokenService).sign({ id: user.id, role });
    return { user, cookie: `${ACCESS_COOKIE}=${token}` };
  };
  const put = (cookie: string, body: object) =>
    http().put('/store-settings').set(CSRF).set('Cookie', cookie).send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    // One shared row: leave it as the migration seeded it for the other test files.
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: { ...SEEDED, ...RULES },
    });
    await app.close();
  });

  it('anyone can read the payment and WhatsApp numbers (seeded with 70 904 044)', async () => {
    const res = await http().get('/store-settings').expect(200);
    expect(res.body).toEqual({
      ...SEEDED,
      requests: RULES,
      deliveryAreas: expect.arrayContaining(['Beirut', 'Matn', 'Tripoli']),
    });
  });

  it('only an admin can change them; staff and customers get 403, anonymous 401', async () => {
    const body = { transferPhone: '71 000 000', whatsappPhone: '71 000 000' };
    await http().put('/store-settings').set(CSRF).send(body).expect(401);
    await put((await cookieFor(Role.CUSTOMER)).cookie, body).expect(403);
    await put((await cookieFor(Role.STAFF)).cookie, body).expect(403);
  });

  it('an admin change is validated, saved, attributed and audit-logged', async () => {
    const admin = await cookieFor(Role.ADMIN);
    await put(admin.cookie, {
      transferPhone: 'call me',
      whatsappPhone: '70 904 044',
    }).expect(400);
    await put(admin.cookie, { transferPhone: '70 904 044' }).expect(400);

    const res = await put(admin.cookie, {
      transferPhone: ' 76 111 222 ',
      transferInstructions: 'Whish or OMT, with your order number in the note',
      whatsappPhone: '+961 70 904 044',
    }).expect(200);
    expect(res.body).toEqual({
      transferPhone: '76 111 222',
      transferInstructions: 'Whish or OMT, with your order number in the note',
      whatsappPhone: '+961 70 904 044',
      requests: RULES,
      deliveryAreas: expect.arrayContaining(['Beirut']),
    });
    await http().get('/store-settings').expect(200, res.body);

    const row = await prisma.storeSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(row.updatedByUserId).toBe(admin.user.id);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: admin.user.id, action: 'store-settings.update' },
    });
    expect(audit).toMatchObject({
      targetType: 'StoreSettings',
      targetId: 'store',
    });
  });

  it("the custom-request rules are the owner's to change: validated, saved, logged", async () => {
    const send = (cookie: string, body: object) =>
      http()
        .put('/store-settings/custom-requests')
        .set(CSRF)
        .set('Cookie', cookie)
        .send(body);
    await send((await cookieFor(Role.STAFF)).cookie, RULES).expect(403);
    const admin = await cookieFor(Role.ADMIN);
    for (const bad of [
      { quoteValidityDays: 0 },
      { quoteValidityDays: 91 },
      { customUploadMaxMb: 101 },
      { estimateSolidityPercent: 4 },
      { estimateSpreadPercent: -1 },
      { depositRefundable: 'yes' },
    ]) {
      await send(admin.cookie, { ...RULES, ...bad }).expect(400);
    }
    const changed = {
      ...RULES,
      quoteValidityDays: 14,
      depositRefundable: false,
    };
    const res = await send(admin.cookie, changed).expect(200);
    expect(res.body.requests).toEqual(changed);
    expect((await http().get('/store-settings')).body.requests).toEqual(
      changed,
    );
    await prisma.auditLog.findFirstOrThrow({
      where: {
        actorUserId: admin.user.id,
        action: 'store-settings.requests.update',
      },
    });
  });

  it('delivery goes only to an area on the list: checked on quotations, edited by the owner', async () => {
    const admin = await cookieFor(Role.ADMIN);
    const quotation = (city: string) =>
      http()
        .post('/quotations')
        .set(CSRF)
        .set('Cookie', admin.cookie)
        .send({
          customerEmail: `areas-${Date.now()}@example.com`,
          validUntil: '2099-12-31',
          customerName: 'Rana Areas',
          phone: '70 123 456',
          paymentMethod: 'COD',
          delivery: true,
          city,
          addressLine: 'Main road, building 3',
          lines: [{ description: 'Sign', quantity: 1, unitPrice: '10.00' }],
        });
    expect((await quotation('Narnia').expect(400)).body.message).toBe(
      'Choose the delivery area from the list',
    );
    // Written as the list writes it.
    expect((await quotation('  beirut ').expect(201)).body.city).toBe('Beirut');

    const areas = (list: string[]) =>
      http()
        .put('/store-settings/delivery-areas')
        .set(CSRF)
        .set('Cookie', admin.cookie)
        .send({ areas: list });
    const before = (await http().get('/store-settings').expect(200)).body
      .deliveryAreas as string[];
    await areas([]).expect(400);
    await areas(['Beirut', 'beirut']).expect(400);
    await http()
      .put('/store-settings/delivery-areas')
      .set(CSRF)
      .set('Cookie', (await cookieFor(Role.STAFF)).cookie)
      .send({ areas: ['Beirut'] })
      .expect(403);
    await areas([...before, 'Narnia']).expect(200);
    await quotation('Narnia').expect(201);
    await areas(before).expect(200);
  });
});
