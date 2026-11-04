import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PasswordResetTokens } from '../src/authorization/password-reset-tokens.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { CSRF } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';
import { registerCustomer } from './mail-helpers.js';

const OLD = 'an old long passphrase';
const NEW = 'a brand new passphrase';

/** A customer's own account: details, password change, "forgot your password". */
describe('Account (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  async function register() {
    const email = uniqueEmail('account');
    const cookie = await registerCustomer(app, {
      email,
      password: OLD,
      name: 'Rana',
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { email, user, cookie };
  }

  it('updates the name and phone; reports whether the address is confirmed', async () => {
    const { cookie } = await register();
    const me = await http()
      .patch('/auth/me')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ name: 'Rana Khoury', phone: '70 123 456' })
      .expect(200);
    expect(me.body).toMatchObject({
      name: 'Rana Khoury',
      phone: '70 123 456',
      // Confirmed by the code emailed at sign-up.
      emailVerified: true,
      hasPassword: true,
    });
  });

  it('changes the password only with the current one; this browser stays signed in', async () => {
    const { cookie, user } = await register();
    await http()
      .post('/auth/password/change')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ currentPassword: 'not the password', newPassword: NEW })
      .expect(400);
    const changed = await http()
      .post('/auth/password/change')
      .set(CSRF)
      .set('Cookie', cookie)
      .send({ currentPassword: OLD, newPassword: NEW })
      .expect(200);
    // Every earlier session ended; a fresh one came with the answer.
    expect(changed.headers['set-cookie']).toBeDefined();
    expect(
      await prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('resets a forgotten password with a link that works once', async () => {
    const { email, user } = await register();
    // The answer is the same for an address with no account.
    await http()
      .post('/auth/password/forgot')
      .set(CSRF)
      .send({ email: uniqueEmail('nobody') })
      .expect(204);
    await http()
      .post('/auth/password/forgot')
      .set(CSRF)
      .send({ email })
      .expect(204);

    const token = await app
      .get(PasswordResetTokens)
      .issue(user.id, user.passwordHash);
    await http()
      .post('/auth/password/reset')
      .set(CSRF)
      .send({ token, password: NEW })
      .expect(204);
    // Used once: the password changed, so the same link is dead.
    await http()
      .post('/auth/password/reset')
      .set(CSRF)
      .send({ token, password: 'yet another passphrase' })
      .expect(400);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(
      await prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    await http()
      .post('/auth/login')
      .set(CSRF)
      .send({ email, password: NEW })
      .expect(200);
  });
});
