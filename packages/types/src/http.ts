/**
 * Names shared by the API and the storefront's server. Changing one here changes both;
 * a mismatch would silently break sign-in, the cart or CSRF protection.
 */
export const HTTP = {
  // "__Host-": the browser takes these only from this exact site, Secure, for every path, and
  // never from a subdomain (staging.forgea-lab.com can't set or replace production's).
  /** 15-minute access JWT (httpOnly, SameSite=Lax). */
  ACCESS_COOKIE: '__Host-forgea_at',
  /** Rotating refresh token (httpOnly, SameSite=Lax). */
  REFRESH_COOKIE: '__Host-forgea_rt',
  /** Signed guest-cart id (httpOnly, SameSite=Lax). */
  CART_COOKIE: '__Host-forgea_cart',
  /** Required with value "1" on every state-changing API request. */
  CSRF_HEADER: 'x-forgea-csrf',
  /** Storefront → API: proves the forwarded shopper IP comes from our own server. */
  PROXY_SECRET_HEADER: 'x-forgea-proxy-secret',
  FORWARDED_CLIENT_IP_HEADER: 'x-forgea-client-ip',
} as const;
