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
    // Browsers drop tabs and newlines, turning these into //evil.example.
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r\n/evil.example',
    '/\t\\evil.example',
    '/x\\..\\..\\evil',
    // Dot segments that normalise to //evil.example.
    '/..//evil.example',
    '/.//evil.example',
    '/%2e%2e//evil.example',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ])('refuses %j', (value) => {
    expect(safeNext(value, '/shop')).toBe('/shop');
  });
});
