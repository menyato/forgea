// Control characters (tab, newline…) and backslashes never belong in a path we link to.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

/**
 * Where to go after signing in. Only same-site paths are allowed, so a crafted link like
 * /sign-in?next=https://evil.example can't bounce a shopper to another site.
 *
 * Browsers silently drop tabs and line breaks from URLs and read a backslash as a slash, so
 * "/\t/evil.example" would become "//evil.example": a link to another site. Such characters
 * are refused outright, and the result must still resolve to this site.
 */
export function safeNext(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (!value || !value.startsWith('/') || UNSAFE.test(value)) return fallback;
  const base = 'https://same.site';
  const url = new URL(value, base);
  if (url.origin !== base) return fallback;
  const path = url.pathname + url.search + url.hash;
  // "/..//evil.example" normalises to "//evil.example": another site again.
  return path.startsWith('//') ? fallback : path;
}
