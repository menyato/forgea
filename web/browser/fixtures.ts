import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Every test is its own visitor: a distinct IP in Cloudflare's header (as production
 * receives it), so the API's per-visitor rate limits treat tests as separate people.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    const n = () => Math.floor(Math.random() * 254) + 1;
    // 198.18.0.0/15 is reserved for benchmark tests: never a real visitor.
    await context.setExtraHTTPHeaders({
      'cf-connecting-ip': `198.18.${n()}.${n()}`,
    });
    await use(context);
  },
});
