import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next.js';

describe('safeNext', () => {
  it.each(['/cart', '/checkout?delivery=true', '/'])(
    'keeps the same-site path %s',
    (path) => {
      expect(safeNext(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ])('refuses %j', (value) => {
    expect(safeNext(value, '/shop')).toBe('/shop');
  });
});
