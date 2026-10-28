import { describe, expect, it, vi } from 'vitest';
import { googleSignInUrl, nextPath, signInFor } from './sign-in-links.server';

vi.stubEnv('PUBLIC_API_URL', 'https://api.forgea.test');
const at = (path: string) => new URL(`https://forgea.test${path}`);

describe('sign-in links', () => {
  it('sends a signed-out shopper to sign in, then back to the exact page', () => {
    expect(signInFor(at('/checkout?currency=LBP&delivery=false'))).toBe(
      '/sign-in?next=%2Fcheckout%3Fcurrency%3DLBP%26delivery%3Dfalse',
    );
    expect(nextPath(at('/sign-in?next=%2Fcheckout%3Fcurrency%3DLBP'))).toBe(
      '/checkout?currency=LBP',
    );
  });

  it('never returns to another site', () => {
    expect(nextPath(at('/sign-in?next=https://evil.example'))).toBe('/');
  });

  it('passes the return page to Google sign-in on the API', () => {
    const url = new URL(googleSignInUrl(at('/sign-in?next=%2Fcheckout')));
    expect(url.origin + url.pathname).toBe(
      'https://api.forgea.test/auth/google',
    );
    expect(url.searchParams.get('next')).toBe('/checkout');
  });
});
