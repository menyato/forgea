import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { OriginPolicy } from './origin-policy.js';

const policy = (env: Partial<EnvironmentVariables>) =>
  new OriginPolicy(
    new ConfigService({
      PUBLIC_WEB_URL: 'https://forgea-lab.com',
      NODE_ENV: 'production',
      DEV_CORS_ORIGINS: ['http://localhost:5173'],
      ...env,
    }) as ConfigService<EnvironmentVariables, true>,
  );

describe('OriginPolicy', () => {
  const prod = policy({});

  it.each([
    'https://forgea-lab.com',
    'https://www.forgea-lab.com',
    'https://admin.forgea-lab.com',
    'https://a.b.forgea-lab.com',
  ])('allows %s', (origin) => {
    expect(prod.isAllowed(origin)).toBe(true);
  });

  it.each([
    'http://forgea-lab.com', // not https
    'https://forgea-lab.com.evil.com',
    'https://evilforgea-lab.com',
    'https://forgea-lab.co',
    'null',
    'http://localhost:5173', // dev origins are ignored in production
  ])('rejects %s', (origin) => {
    expect(prod.isAllowed(origin)).toBe(false);
  });

  it('rejects a missing origin', () => {
    expect(prod.isAllowed(undefined)).toBe(false);
  });

  it('allows the configured dev origins outside production', () => {
    const dev = policy({
      NODE_ENV: 'development',
      PUBLIC_WEB_URL: 'http://localhost:5173',
    });
    expect(dev.isAllowed('http://localhost:5173')).toBe(true);
    expect(dev.isAllowed('http://localhost:9999')).toBe(false);
  });
});
