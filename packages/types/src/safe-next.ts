/**
 * Where to go after signing in. Only same-site paths are allowed, so a crafted link like
 * /sign-in?next=https://evil.example can't bounce a shopper to another site.
 */
export function safeNext(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  )
    return fallback;
  return value;
}
