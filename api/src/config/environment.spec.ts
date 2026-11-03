import { validateEnvironment } from './environment.js';

const secret = 'x'.repeat(32);
const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/forgea',
  JWT_ACCESS_SECRET: secret,
  COOKIE_SECRET: 'y'.repeat(32),
};

const production = {
  ...valid,
  NODE_ENV: 'production',
  PUBLIC_WEB_URL: 'https://forgea-lab.com',
  // The API's sign-in paths are served from the website's own host.
  PUBLIC_API_URL: 'https://forgea-lab.com',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  INTERNAL_PROXY_SECRET: 'z'.repeat(32),
};

describe('validateEnvironment', () => {
  it('accepts the minimum local configuration with safe defaults', () => {
    const env = validateEnvironment(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.TRUST_CLOUDFLARE).toBe(false);
    expect(env.WORKSPACE_DOMAIN).toBe('forgea-lab.com');
  });

  it('converts the strings the environment provides', () => {
    const env = validateEnvironment({
      ...valid,
      PORT: '8080',
      TRUST_CLOUDFLARE: 'true',
      DEV_CORS_ORIGINS: 'http://localhost:5173, http://localhost:4173',
    });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_CLOUDFLARE).toBe(true);
    expect(env.DEV_CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
  });

  it('accepts a complete production configuration', () => {
    expect(() => validateEnvironment(production)).not.toThrow();
  });

  it('treats an empty "NAME=" line as not set, as the deploy templates leave them', () => {
    const env = validateEnvironment({
      ...production,
      MAIL_SENDER: '',
      STUDIO_NOTIFY_EMAIL: '',
      GOOGLE_SERVICE_ACCOUNT_KEY: '',
      GOOGLE_CALENDAR_ID: '',
    });
    expect(env.MAIL_SENDER).toBeUndefined();
    // A required setting left empty is still refused.
    expect(() =>
      validateEnvironment({ ...production, JWT_ACCESS_SECRET: '' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it.each([
    [{ DATABASE_URL: undefined }, /DATABASE_URL/],
    [{ DATABASE_URL: 'mysql://x' }, /postgres:\/\//],
    [{ PORT: '70000' }, /PORT/],
    [{ JWT_ACCESS_SECRET: 'short' }, /JWT_ACCESS_SECRET must be at least 32/],
    [{ COOKIE_SECRET: undefined }, /COOKIE_SECRET/],
    [{ GOOGLE_CLIENT_ID: 'id' }, /must be set together/],
    [{ NODE_ENV: 'staging' }, /NODE_ENV/],
  ])('rejects %o', (override, message) => {
    expect(() => validateEnvironment({ ...valid, ...override })).toThrow(
      message,
    );
  });

  it.each([
    [
      { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined },
      /Google sign-in is required/,
    ],
    [
      { PUBLIC_WEB_URL: 'http://forgea-lab.com' },
      /PUBLIC_WEB_URL must use https/,
    ],
    [{ COOKIE_SECRET: secret }, /must differ/],
  ])('in production rejects %o', (override, message) => {
    expect(() => validateEnvironment({ ...production, ...override })).toThrow(
      message,
    );
  });
});
