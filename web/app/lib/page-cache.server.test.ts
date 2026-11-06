import { describe, expect, it } from 'vitest';
import { pageCacheMiddleware } from './page-cache.server';

const site = 'https://forgea-lab.com';
let n = 0;
/** A page render that counts how often it ran, answering with its run number. */
function render(init: ResponseInit = {}) {
  const calls = { count: 0 };
  const next = async () => {
    calls.count++;
    return new Response(`page ${++n}`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
      ...init,
    });
  };
  return { calls, next };
}
const get = (path: string, cookie?: string) =>
  new Request(`${site}${path}`, cookie ? { headers: { cookie } } : {});
const visit = async (
  path: string,
  next: () => Promise<Response>,
  cookie?: string,
) => {
  const res = await pageCacheMiddleware({ request: get(path, cookie) }, next);
  // Let the kept copy finish (it is read while the first visitor is served).
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 5));
  return { text, state: res.headers.get('x-forgea-page-cache') };
};

describe('pageCacheMiddleware', () => {
  it('builds a public page once for visitors without our cookies', async () => {
    const { calls, next } = render();
    const first = await visit('/products/vase-a', next);
    const second = await visit('/products/vase-a', next);
    expect(calls.count).toBe(1);
    expect(second).toEqual({ text: first.text, state: 'hit' });
  });

  it('keeps light and dark apart, and data requests apart from pages', async () => {
    const { calls, next } = render();
    await visit('/shop', next, 'forgea_theme=dark');
    await visit('/shop', next, 'forgea_theme=light');
    await visit('/shop.data', next, 'forgea_theme=dark');
    await visit('/shop', next, 'forgea_theme=dark');
    expect(calls.count).toBe(3);
  });

  it('never reuses a page for someone signed in, with a cart or mid-sign-up', async () => {
    for (const cookie of [
      '__Host-forgea_at=x',
      '__Host-forgea_rt=x',
      '__Host-forgea_cart=x',
      'forgea_pending=x',
    ]) {
      const { calls, next } = render();
      await visit('/products/vase-b', next, cookie);
      await visit('/products/vase-b', next, cookie);
      expect(calls.count).toBe(2);
    }
  });

  it('never keeps private paths, errors, or a response that sets a cookie', async () => {
    for (const path of [
      '/cart',
      '/checkout',
      '/account',
      '/orders',
      '/admin',
      '/q/abc',
    ]) {
      const { calls, next } = render();
      await visit(path, next);
      await visit(path, next);
      expect(calls.count).toBe(2);
    }
    const failing = render({ status: 500 });
    await visit('/products/broken', failing.next);
    await visit('/products/broken', failing.next);
    expect(failing.calls.count).toBe(2);
    const cookie = render({
      headers: { 'set-cookie': '__Host-forgea_cart=new' },
    });
    await visit('/products/vase-c', cookie.next);
    await visit('/products/vase-c', cookie.next);
    expect(cookie.calls.count).toBe(2);
  });

  it('builds a page once for many visitors arriving together', async () => {
    const { calls, next } = render();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => visit('/products/vase-d', next)),
    );
    expect(calls.count).toBe(1);
    expect(new Set(results.map((r) => r.text)).size).toBe(1);
  });

  it('a change saved in the dashboard shows at once', async () => {
    const { calls, next } = render();
    await visit('/products/vase-e', next);
    await pageCacheMiddleware(
      { request: new Request(`${site}/admin/products/p1`, { method: 'POST' }) },
      async () => new Response(null, { status: 204 }),
    );
    await visit('/products/vase-e', next);
    expect(calls.count).toBe(2);
  });

  it('a visitor turned away from the dashboard leaves the pages cached', async () => {
    const { calls, next } = render();
    await visit('/products/vase-f', next);
    await pageCacheMiddleware(
      { request: new Request(`${site}/admin`, { method: 'POST' }) },
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: '/sign-in?next=%2Fadmin' },
        }),
    );
    await visit('/products/vase-f', next);
    expect(calls.count).toBe(1);
  });
});
