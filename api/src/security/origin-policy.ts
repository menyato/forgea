import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type EnvironmentVariables,
  isProduction,
} from '../config/environment.js';

/**
 * The CORS / CSRF allowlist: the storefront's own origin and https subdomains of it
 * (forgea-lab.com, www.forgea-lab.com, admin.forgea-lab.com …). In development, the
 * explicit DEV_CORS_ORIGINS are allowed as well.
 */
@Injectable()
export class OriginPolicy {
  private readonly siteOrigin: string;
  private readonly subdomainPattern: RegExp;
  private readonly devOrigins: ReadonlySet<string>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const web = new URL(config.get('PUBLIC_WEB_URL', { infer: true }));
    this.siteOrigin = web.origin;
    const host = web.hostname.replace(/^www\./, '').replace(/\./g, '\\.');
    this.subdomainPattern = new RegExp(`^https://([a-z0-9-]+\\.)+${host}$`);
    this.devOrigins = new Set(
      isProduction({ NODE_ENV: config.get('NODE_ENV', { infer: true }) })
        ? []
        : config.get('DEV_CORS_ORIGINS', { infer: true }),
    );
  }

  isAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    return (
      origin === this.siteOrigin ||
      this.subdomainPattern.test(origin) ||
      this.devOrigins.has(origin)
    );
  }
}
