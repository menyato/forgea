import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard.js';
import type { OriginPolicy } from './origin-policy.js';

const origins = {
  isAllowed: (o: string | undefined) => o === 'https://forgea-lab.com',
} as unknown as OriginPolicy;
const guard = new CsrfGuard(origins);

function contextFor(
  method: string,
  headers: Record<string, string>,
): ExecutionContext {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req = { method, get: (name: string) => lower[name.toLowerCase()] };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through', (method) => {
    expect(guard.canActivate(contextFor(method, {}))).toBe(true);
  });

  it('allows a POST with the header from an allowed origin', () => {
    const ctx = contextFor('POST', {
      'x-forgea-csrf': '1',
      origin: 'https://forgea-lab.com',
      'sec-fetch-site': 'same-site',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a server-to-server POST with the header and no Origin', () => {
    expect(
      guard.canActivate(contextFor('POST', { 'x-forgea-csrf': '1' })),
    ).toBe(true);
  });

  it.each([
    ['no header', {}],
    ['wrong header value', { 'x-forgea-csrf': 'yes' }],
    [
      'foreign origin',
      { 'x-forgea-csrf': '1', origin: 'https://evil.example' },
    ],
    [
      'cross-site fetch',
      { 'x-forgea-csrf': '1', 'sec-fetch-site': 'cross-site' },
    ],
  ])('refuses a POST with %s', (_case, headers) => {
    expect(() => guard.canActivate(contextFor('POST', headers))).toThrow(
      ForbiddenException,
    );
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('checks %s too', (method) => {
    expect(() => guard.canActivate(contextFor(method, {}))).toThrow(
      ForbiddenException,
    );
  });
});
