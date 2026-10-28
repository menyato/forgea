import type { Request } from 'express';
import { googleReturnPath } from './google-oidc.js';

const withSession = (session: Record<string, unknown> | null) =>
  ({ session }) as unknown as Request;

describe('googleReturnPath', () => {
  it('returns the page saved when Google sign-in started', () => {
    expect(
      googleReturnPath(withSession({ next: '/checkout?currency=LBP' })),
    ).toBe('/checkout?currency=LBP');
  });

  it('falls back to the home page when nothing (or something unsafe) was saved', () => {
    expect(googleReturnPath(withSession(null))).toBe('/');
    expect(googleReturnPath(withSession({}))).toBe('/');
    expect(googleReturnPath(withSession({ next: '//evil.example' }))).toBe('/');
  });
});
