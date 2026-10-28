/**
 * Names shared by the API and the storefront's server. Changing one here changes both;
 * a mismatch would silently break sign-in, the cart or CSRF protection.
 */
export const HTTP = {
  /** 15-minute access JWT (httpOnly, SameSite=Strict). */
  ACCESS_COOKIE: 'forgea_at',
  /** Rotating refresh token (httpOnly, SameSite=Strict). */
  REFRESH_COOKIE: 'forgea_rt',
  /** Signed guest-cart id (httpOnly, SameSite=Lax). */
  CART_COOKIE: 'forgea_cart',
  /** Required with value "1" on every state-changing API request. */
  CSRF_HEADER: 'x-forgea-csrf',
  /** Storefront → API: proves the forwarded shopper IP comes from our own server. */
  PROXY_SECRET_HEADER: 'x-forgea-proxy-secret',
  FORWARDED_CLIENT_IP_HEADER: 'x-forgea-client-ip',
} as const;
