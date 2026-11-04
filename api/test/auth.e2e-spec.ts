import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { UsersRepository } from '../src/users/users.repository.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../src/authorization/auth-cookies.js';
import { cookiesFrom, createApp, uniqueEmail } from './create-app.js';
import { latestCode } from './mail-helpers.js';

const CSRF = { 'x-forgea-csrf': '1' };
const PASSWORD = 'a long enough passphrase';

// Note: @Throttle(THROTTLE.auth) allows 5 calls per route per minute per IP, and every
// test here shares one IP — so each route is called at most 5 times in this file.
describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const email = uniqueEmail('customer');

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const cookieHeader = (jar: Record<string, { value: string }>) =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v.value}`)
      .join('; ');

  it('register emails a code; the code signs in with httpOnly, Secure, SameSite=Strict cookies', async () => {
    const pending = await http()
      .post('/auth/register')
      .set(CSRF)
      .send({ email: email.toUpperCase(), password: PASSWORD, name: 'Test' })
      .expect(202);
    // Not signed in yet: only a ticket that works together with the emailed code.
    expect(pending.body).toEqual({ email, ticket: expect.any(String) });
    expect(pending.headers['set-cookie']).toBeUndefined();

    const wrong = await http()
      .post('/auth/email-code')
      .set(CSRF)
      .send({ ticket: pending.body.ticket, code: '000000' })
      .expect(400);
    expect(wrong.body.message).toMatch(/not right/);

    const res = await http()
      .post('/auth/email-code')
      .set(CSRF)
      .send({ ticket: pending.body.ticket, code: await latestCode(app, email) })
      .expect(200);
    expect(res.body).toMatchObject({ email, role: 'CUSTOMER', name: 'Test' });
    const jar = cookiesFrom(res.headers['set-cookie']);
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(jar[name]?.attrs).toEqual(
        expect.arrayContaining([
          'httponly',
          'secure',
          'samesite=strict',
          'path=/',
        ]),
      );
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects unknown fields, so nobody can register themselves as ADMIN', async () => {
    const res = await http()
      .post('/auth/register')
      .set(CSRF)
      .send({ email: uniqueEmail('x'), password: PASSWORD, role: 'ADMIN' })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain(
      'property role should not exist',
    );
  });

  it('refuses to register a Workspace (staff) address', async () => {
    await http()
      .post('/auth/register')
      .set(CSRF)
      .send({
        email: `someone-${Date.now()}@forgea-lab.com`,
        password: PASSWORD,
      })
      .expect(400);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrong = await http()
      .post('/auth/login')
      .set(CSRF)
      .send({ email, password: 'nope' })
      .expect(401);
    const unknown = await http()
      .post('/auth/login')
      .set(CSRF)
      .send({ email: uniqueEmail('ghost'), password: 'nope' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('refresh rotates the token, and replaying an old one ends the whole session', async () => {
    const login = await http()
      .post('/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(200);
    const first = cookiesFrom(login.headers['set-cookie']);

    const me = await http()
      .get('/auth/me')
      .set('Cookie', cookieHeader(first))
      .expect(200);
    expect(me.body.email).toBe(email);

    const rotated = await http()
      .post('/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(first))
      .expect(200);
    const second = cookiesFrom(rotated.headers['set-cookie']);
    expect(second[REFRESH_COOKIE]?.value).not.toBe(
      first[REFRESH_COOKIE]?.value,
    );

    // An attacker replays the first refresh token…
    await http()
      .post('/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(first))
      .expect(401);
    // …which also kills the legitimate user's newer token: both must sign in again.
    await http()
      .post('/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(second))
      .expect(401);
  });

  it('logout revokes the refresh token and clears the cookies', async () => {
    const login = await http()
      .post('/auth/login')
      .set(CSRF)
      .send({ email, password: PASSWORD })
      .expect(200);
    const jar = cookiesFrom(login.headers['set-cookie']);
    const out = await http()
      .post('/auth/logout')
      .set(CSRF)
      .set('Cookie', cookieHeader(jar))
      .expect(204);
    expect(cookiesFrom(out.headers['set-cookie'])[REFRESH_COOKIE]?.value).toBe(
      '',
    );
    await http()
      .post('/auth/refresh')
      .set(CSRF)
      .set('Cookie', cookieHeader(jar))
      .expect(401);
  });

  it('signs out whoever registered an address first, once Google proves its real owner', async () => {
    // Someone registers the victim's address with a password, and keeps the session.
    const victim = uniqueEmail('victim');
    await http()
      .post('/auth/register')
      .set(CSRF)
      .send({ email: victim, password: PASSWORD })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: victim },
    });
    // Later the real owner signs in with Google (the account is linked).
    await app.get(UsersRepository).linkGoogle(user, `google-${user.id}`);
    expect(
      await prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .passwordHash,
    ).toBeNull();
  });

  it('GET /auth/me requires a session', async () => {
    await http().get('/auth/me').expect(401);
  });

  describe('CSRF', () => {
    it('refuses a state-changing request without the CSRF header', async () => {
      await http().post('/auth/logout').expect(403);
    });

    it('refuses a request from a foreign origin', async () => {
      await http()
        .post('/auth/logout')
        .set(CSRF)
        .set('Origin', 'https://evil.example')
        .expect(403);
    });

    it('does not grant CORS to a foreign origin', async () => {
      const res = await http()
        .options('/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('sends security headers', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rate-limits login attempts', async () => {
    // Three logins above + these: the 6th call within a minute is refused.
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await http()
        .post('/auth/login')
        .set(CSRF)
        .send({ email, password: 'nope' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
