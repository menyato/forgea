import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AccessTokenService } from '../src/authorization/access-token.service.js';
import { ACCESS_COOKIE } from '../src/authorization/auth-cookies.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import { CurrenciesService } from '../src/currencies/currencies.service.js';
import { createApp, uniqueEmail } from './create-app.js';

const CSRF = { 'x-forgea-csrf': '1' };

describe('Currencies (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const cookieFor = async (role: Role) => {
    const user = await prisma.user.create({
      data: { email: uniqueEmail(role.toLowerCase()), role },
    });
    const token = await app.get(AccessTokenService).sign({ id: user.id, role });
    return { user, cookie: `${ACCESS_COOKIE}=${token}` };
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('lists USD as the base and LBP at the seeded rate', async () => {
    const res = await request(app.getHttpServer())
      .get('/currencies')
      .expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        code: 'USD',
        isBase: true,
        rate: '1',
        decimals: 2,
      }),
      expect.objectContaining({
        code: 'LBP',
        isBase: false,
        decimals: 0,
        roundingStep: '5000',
      }),
    ]);
  });

  it('lets an admin set a new rate, keeps the old one in history, and audit-logs it', async () => {
    const { user, cookie } = await cookieFor(Role.ADMIN);
    const res = await request(app.getHttpServer())
      .put('/currencies/lbp/rate')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ rate: '90000' })
      .expect(200);
    expect(res.body).toMatchObject({ code: 'LBP', rate: '90000' });

    const history = await prisma.exchangeRate.count({
      where: { currencyCode: 'LBP' },
    });
    expect(history).toBeGreaterThanOrEqual(2);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'currency.rate.set', actorUserId: user.id },
    });
    expect(audit).toMatchObject({ targetType: 'Currency', targetId: 'LBP' });

    // Converters now use the new rate: $10 → 900,000 LBP.
    const lbp = await app.get(CurrenciesService).converterFor('LBP');
    expect(lbp.convert('10')).toBe('900000');
  });

  it.each([Role.STAFF, Role.CUSTOMER])(
    'refuses %s (financial settings are admin-only)',
    async (role) => {
      const { cookie } = await cookieFor(role);
      await request(app.getHttpServer())
        .put('/currencies/LBP/rate')
        .set(CSRF)
        .set('Cookie', cookie)
        .send({ rate: '1' })
        .expect(403);
    },
  );

  it('refuses changing the base currency rate and invalid rates', async () => {
    const { cookie } = await cookieFor(Role.ADMIN);
    const put = (code: string, rate: unknown) =>
      request(app.getHttpServer())
        .put(`/currencies/${code}/rate`)
        .set(CSRF)
        .set('Cookie', cookie)
        .send({ rate });
    await put('USD', '2').expect(400);
    await put('LBP', '0').expect(400);
    await put('LBP', 89500).expect(400);
    await put('XYZ', '5').expect(404);
  });

  it('refuses anonymous rate changes', async () => {
    await request(app.getHttpServer())
      .put('/currencies/LBP/rate')
      .set(CSRF)
      .send({ rate: '1' })
      .expect(401);
  });
});
