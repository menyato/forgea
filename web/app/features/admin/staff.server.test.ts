import { Role } from '@forgea/types';
import { describe, expect, it } from 'vitest';
import { staffMiddleware } from './staff.server';

/** The middleware with an API client whose `me()` answers as given. */
const run = (me: unknown) =>
  staffMiddleware(
    {
      url: new URL('http://localhost/admin/orders'),
      context: {
        get: () => ({ hasSession: true, me: () => Promise.resolve(me) }),
        set: () => undefined,
      },
    } as never,
    () => Promise.resolve(new Response('page')),
  );

describe('staffMiddleware', () => {
  it('says "one moment" when the API is rate limiting, never "not allowed"', async () => {
    await expect(
      run({ ok: false, status: 429, message: 'Too many requests' }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      run({ ok: false, status: 502, message: 'Bad gateway' }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('still refuses customers', async () => {
    await expect(
      run({ ok: true, status: 200, data: { role: Role.CUSTOMER } }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
