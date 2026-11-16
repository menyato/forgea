import { Injectable } from '@nestjs/common';
import { HTTP } from '@forgea/types';
import type { CookieOptions, Request, Response } from 'express';

export const CART_COOKIE = HTTP.CART_COOKIE;
const UUID = /^[0-9a-f-]{36}$/;

/**
 * Identifies a guest's cart. The value is signed with COOKIE_SECRET, so nobody can point it
 * at another cart. SameSite=Lax (not Strict) so the cart is still there when a visitor
 * arrives from a link; it is not a credential, and cart changes still need the CSRF header.
 */
@Injectable()
export class CartCookie {
  private readonly options: CookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: 30 * 86_400_000,
  };

  read(req: Request): string | undefined {
    const signed: unknown = req.signedCookies;
    if (typeof signed !== 'object' || signed === null) return undefined;
    const value = (signed as Record<string, unknown>)[CART_COOKIE];
    return typeof value === 'string' && UUID.test(value) ? value : undefined;
  }

  set(res: Response, cartId: string): void {
    res.cookie(CART_COOKIE, cartId, this.options);
  }

  clear(res: Response): void {
    // Without `signed`, so the expired cookie carries an empty value rather than a signed one.
    const { maxAge: _maxAge, signed: _signed, ...rest } = this.options;
    res.clearCookie(CART_COOKIE, rest);
  }
}
