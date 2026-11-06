import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'k'.repeat(40);
let signInError: (url: URL) => string | null;

beforeAll(async () => {
  process.env['INTERNAL_PROXY_SECRET'] = SECRET;
  ({ signInError } = await import('./sign-in-error.server'));
});

const sign = (text: string) =>
  createHmac('sha256', SECRET)
    .update(`sign-in-error:${text}`)
    .digest('base64url');
const at = (query: Record<string, string>) =>
  new URL(`https://shop.test/sign-in?${new URLSearchParams(query)}`);

describe('the sign-in page error', () => {
  it('shows the API’s own signed words', () => {
    const text = 'Use your Workspace account';
    expect(signInError(at({ error: text, sig: sign(text) }))).toBe(text);
  });
  it('never shows words someone put in a link', () => {
    const text = 'Your account is locked: message +961 70 000 000';
    expect(signInError(at({ error: text }))).toMatch(/didn't work/);
    expect(
      signInError(at({ error: text, sig: sign('something else') })),
    ).toMatch(/didn't work/);
  });
  it('is nothing without an error', () => {
    expect(signInError(at({}))).toBeNull();
  });
});
