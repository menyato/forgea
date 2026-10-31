import { describe, expect, it } from 'vitest';
import { ApiClient } from './api-client.server';
import type { ServerEnv } from './env.server';

const env: ServerEnv = {
  API_URL: 'http://api.test',
  PUBLIC_API_URL: 'http://api.test',
  PUBLIC_WEB_URL: 'http://web.test',
  INTERNAL_PROXY_SECRET: 's'.repeat(40),
  TRUST_CLOUDFLARE: true,
};

interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

/** A fake API: returns the queued responses in order and records every request. */
function fakeApi(...responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call to ${url.pathname}`);
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown, setCookies: string[] = []) => {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
};

const browser = (headers: Record<string, string>) =>
  new Request('http://web.test/cart', { headers });

describe('ApiClient', () => {
  it("forwards the shopper's cookies, the CSRF header and their Cloudflare IP", async () => {
    const api = fakeApi(json(200, { ok: true }));
    const client = new ApiClient(
      browser({
        cookie: 'forgea_at=abc; forgea_cart=s%3Axyz',
        'cf-connecting-ip': '203.0.113.9',
      }),
      env,
      api.fetchImpl,
    );
    await client.post('/cart/items', { productId: 'p' });

    const sent = api.calls[0]!;
    expect(sent.headers.get('cookie')).toBe(
      'forgea_at=abc; forgea_cart=s%3Axyz',
    );
    expect(sent.headers.get('x-forgea-csrf')).toBe('1');
    expect(sent.headers.get('x-forgea-client-ip')).toBe('203.0.113.9');
    expect(sent.headers.get('x-forgea-proxy-secret')).toBe(
      env.INTERNAL_PROXY_SECRET,
    );
    expect(sent.body).toEqual({ productId: 'p' });
  });

  it('never forwards an IP outside Cloudflare (a browser could forge it)', async () => {
    const api = fakeApi(json(200, {}));
    await new ApiClient(
      browser({ 'cf-connecting-ip': '6.6.6.6' }),
      { ...env, TRUST_CLOUDFLARE: false },
      api.fetchImpl,
    ).get('/products');
    expect(api.calls[0]!.headers.get('x-forgea-client-ip')).toBeNull();
    expect(api.calls[0]!.headers.get('x-forgea-proxy-secret')).toBeNull();
  });

  it('relays the cookies the API sets back to the browser', async () => {
    const api = fakeApi(
      json(201, {}, [
        'forgea_cart=s%3Anew; Path=/; HttpOnly; Secure; SameSite=Lax',
      ]),
    );
    const client = new ApiClient(browser({}), env, api.fetchImpl);
    await client.post('/cart/items', {});
    expect(client.headers.getSetCookie()).toEqual([
      'forgea_cart=s%3Anew; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('renews an expired access token once with the refresh cookie, then retries', async () => {
    const api = fakeApi(
      json(401, { message: 'Unauthorized' }),
      json(200, { id: 'u1' }, [
        'forgea_at=fresh; Path=/; HttpOnly',
        'forgea_rt=rotated; Path=/; HttpOnly',
      ]),
      json(200, { email: 'a@b.co' }),
    );
    const client = new ApiClient(
      browser({ cookie: 'forgea_at=stale; forgea_rt=old' }),
      env,
      api.fetchImpl,
    );
    const result = await client.get<{ email: string }>('/orders/mine');

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { email: 'a@b.co' },
    });
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /orders/mine',
      'POST /auth/refresh',
      'GET /orders/mine',
    ]);
    // The retry carries the new cookies, and the browser gets them too.
    expect(api.calls[2]!.headers.get('cookie')).toBe(
      'forgea_at=fresh; forgea_rt=rotated',
    );
    expect(client.headers.getSetCookie()).toHaveLength(2);
  });

  it('does not try to refresh without a refresh cookie, or for auth routes', async () => {
    const noRefresh = fakeApi(json(401, { message: 'Unauthorized' }));
    await new ApiClient(browser({}), env, noRefresh.fetchImpl).get(
      '/orders/mine',
    );
    expect(noRefresh.calls).toHaveLength(1);

    const authRoute = fakeApi(
      json(401, { message: 'Email or password is incorrect' }),
    );
    const r = await new ApiClient(
      browser({ cookie: 'forgea_rt=x' }),
      env,
      authRoute.fetchImpl,
    ).post('/auth/login', {});
    expect(authRoute.calls).toHaveLength(1);
    expect(r).toEqual({
      ok: false,
      status: 401,
      message: 'Email or password is incorrect',
    });
  });

  it('forgets cookies the API clears', async () => {
    const api = fakeApi(
      json(201, {}, [
        'forgea_cart=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ]),
      json(200, {}),
    );
    const client = new ApiClient(
      browser({ cookie: 'forgea_cart=s%3Aold' }),
      env,
      api.fetchImpl,
    );
    await client.post('/orders/checkout', {});
    await client.get('/cart');
    expect(api.calls[1]!.headers.get('cookie')).toBeNull();
  });

  it('turns validation errors into one readable message', async () => {
    const api = fakeApi(
      json(400, { message: ['Enter your name', 'Enter a valid phone number'] }),
    );
    const r = await new ApiClient(browser({}), env, api.fetchImpl).post(
      '/orders/checkout',
      {},
    );
    expect(r).toEqual({
      ok: false,
      status: 400,
      message: 'Enter your name Enter a valid phone number',
    });
  });

  it('refreshes only once when parallel calls all find the token expired', async () => {
    const api = fakeApi(
      json(401, {}),
      json(401, {}),
      json(200, {}, ['forgea_at=fresh; Path=/', 'forgea_rt=rotated; Path=/']),
      json(200, { a: 1 }),
      json(200, { b: 2 }),
    );
    const client = new ApiClient(
      browser({ cookie: 'forgea_rt=old' }),
      env,
      api.fetchImpl,
    );
    const [a, b] = await Promise.all([
      client.get('/orders/mine'),
      client.get('/cart'),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(api.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('renews for GET /auth/me (the header needs to know who is signed in)', async () => {
    const api = fakeApi(
      json(401, {}),
      json(200, {}, ['forgea_at=fresh; Path=/']),
      json(200, { email: 'a@b.co' }),
    );
    const r = await new ApiClient(
      browser({ cookie: 'forgea_rt=old' }),
      env,
      api.fetchImpl,
    ).get('/auth/me');
    expect(r.ok).toBe(true);
  });

  it('shares the store settings between visitors for a while; a change sent through it forgets them', async () => {
    const api = fakeApi(
      json(200, { whatsappPhone: 'old' }),
      json(200, { ok: true }),
      json(200, { whatsappPhone: 'new' }),
    );
    const visitor = () => new ApiClient(browser({}), env, api.fetchImpl);
    // Two visitors at once: one call.
    const [a, b] = await Promise.all([
      visitor().shared('/store-settings'),
      visitor().shared('/store-settings'),
    ]);
    expect(a).toEqual(b);
    expect(api.calls).toHaveLength(1);
    // The owner saves: the next visitor sees the new numbers.
    await visitor().put('/store-settings', { whatsappPhone: 'new' });
    const after = await visitor().shared<{ whatsappPhone: string }>(
      '/store-settings',
    );
    expect(after.ok && after.data.whatsappPhone).toBe('new');
    expect(api.calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET']);
  });

  it('never keeps a failed shared read', async () => {
    const api = fakeApi(
      json(503, { message: 'down' }),
      json(200, { theme: null }),
    );
    const visitor = () => new ApiClient(browser({}), env, api.fetchImpl);
    expect((await visitor().shared('/site-theme')).ok).toBe(false);
    // Let the failure be dropped, then the next visitor asks again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await visitor().shared('/site-theme')).ok).toBe(true);
    expect(api.calls).toHaveLength(2);
  });
});
