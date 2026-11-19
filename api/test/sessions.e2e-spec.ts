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

  // These two ask the service directly: the refresh endpoint's rate limit is per app.
  it('a refresh token replayed again in that moment, or from elsewhere, opens nothing more', async () => {
    const { user } = await signedInCustomer(app);
    const sessions = app.get(SessionService);
    const browser = { ip: null, userAgent: 'Replay test browser' };
    const token = await sessions.start(user.id, browser);
    // The browser itself refreshes (rotates), and a second tab rides the grace once.
    await expect(sessions.rotate(token, browser)).resolves.toBeDefined();
    await expect(sessions.rotate(token, browser)).resolves.toBeDefined();
    // A third use of the same old token is a copy: refused, and the login ends.
    await expect(sessions.rotate(token, browser)).rejects.toThrow(
      /sign in again/,
    );
  });

  it('a just-rotated token from another browser or address is refused', async () => {
    const { user } = await signedInCustomer(app);
    const sessions = app.get(SessionService);
    const owner = { ip: '198.51.100.7', userAgent: 'The owner browser' };
    const first = await sessions.start(user.id, owner);
    await sessions.rotate(first, owner);
    await expect(
      sessions.rotate(first, { ...owner, userAgent: 'Someone else' }),
    ).rejects.toThrow(/sign in again/);
    const second = await sessions.start(user.id, owner);
    await sessions.rotate(second, owner);
    await expect(
      sessions.rotate(second, { ...owner, ip: '203.0.113.9' }),
    ).rejects.toThrow(/sign in again/);
  });
});
