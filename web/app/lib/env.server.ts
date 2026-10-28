import 'dotenv/config';

/** Server-only settings for the storefront. Read once; the process exits on a bad value. */
export interface ServerEnv {
  /** Where the storefront calls the API from its own server (not shown to browsers). */
  API_URL: string;
  /** The API's public URL, for links the browser follows directly (Google sign-in). */
  PUBLIC_API_URL: string;
  /** This site's own origin; state-changing requests must come from it. */
  PUBLIC_WEB_URL: string;
  /** Shared with the API so it trusts the shopper IP we forward (rate limiting). */
  INTERNAL_PROXY_SECRET: string | undefined;
  /** Take the shopper's IP from Cloudflare's CF-Connecting-IP (production only). */
  TRUST_CLOUDFLARE: boolean;
}

function url(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be a URL, got "${value}"`);
  }
}

function load(): ServerEnv {
  const secret = process.env['INTERNAL_PROXY_SECRET'] || undefined;
  if (secret !== undefined && secret.length < 32) {
    throw new Error('INTERNAL_PROXY_SECRET must be at least 32 characters');
  }
  return {
    API_URL: url('API_URL', 'http://localhost:3000'),
    PUBLIC_API_URL: url('PUBLIC_API_URL', 'http://localhost:3000'),
    PUBLIC_WEB_URL: url('PUBLIC_WEB_URL', 'http://localhost:5173'),
    INTERNAL_PROXY_SECRET: secret,
    TRUST_CLOUDFLARE: process.env['TRUST_CLOUDFLARE'] === 'true',
  };
}

let cached: ServerEnv | undefined;
export const serverEnv = (): ServerEnv => (cached ??= load());
