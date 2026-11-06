import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { SessionService } from '../src/auth/session.service.js';
import { REFRESH_COOKIE } from '../src/authorization/auth-cookies.js';
import { CSRF, signedInCustomer } from './commerce-helpers.js';
import { cookiesFrom, createApp } from './create-app.js';

// Its own file: the sign-in endpoints' rate limit is per app, and auth.e2e-spec uses it up.
describe('Sessions (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const cookieHeader = (c: Record<string, { value: string }>) =>
    Object.entries(c)
      .map(([k, v]) => `${k}=${v.value}`)
      .join('; ');

  it('two tabs refreshing with the same token at once both stay signed in', async () => {
    const { user } = await signedInCustomer(app);
    // A login from this browser (its refresh token remembers the browser).
    const browser = 'Tab test browser';
    const token = await app
      .get(SessionService)
      .start(user.id, { ip: null, userAgent: browser });
    const jar = `${REFRESH_COOKIE}=${token}`;
    const refresh = (c: string) =>
      http()
        .post('/auth/refresh')
        .set(CSRF)
        .set('User-Agent', browser)
        .set('Cookie', c);
    const [a, b] = await Promise.all([refresh(jar), refresh(jar)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    for (const r of [a, b])
      await refresh(cookieHeader(cookiesFrom(r.headers['set-cookie']))).expect(
        200,
      );
  });
});
