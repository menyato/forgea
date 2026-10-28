import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { HTTP } from '@forgea/types';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { EnvironmentVariables } from '../config/environment.js';

/** Sent by the storefront's server when it calls the API on a shopper's behalf. */
const { PROXY_SECRET_HEADER, FORWARDED_CLIENT_IP_HEADER } = HTTP;

export interface ClientIpTrust {
  trustCloudflare: boolean;
  /** When set, a request carrying this secret may name the shopper's IP. */
  proxySecret?: string | undefined;
}

const header = (
  req: Pick<Request, 'headers'>,
  name: string,
): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Constant-time comparison (hashing first makes the lengths equal). */
function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * The client's IP for rate limiting and audit logs.
 * 1. The storefront calls the API server-to-server for every shopper, so it forwards the
 *    shopper's IP — trusted only together with the shared proxy secret; without this every
 *    shopper would share the storefront server's single rate-limit bucket.
 * 2. Behind Cloudflare, CF-Connecting-IP — only when TRUST_CLOUDFLARE is on.
 * 3. Otherwise the connection's own address.
 */
export function resolveClientIp(
  req: Pick<Request, 'ip' | 'headers'>,
  trust: ClientIpTrust,
): string {
  if (trust.proxySecret) {
    const secret = header(req, PROXY_SECRET_HEADER);
    const forwarded = header(req, FORWARDED_CLIENT_IP_HEADER);
    if (
      secret &&
      sameSecret(secret, trust.proxySecret) &&
      forwarded &&
      isIP(forwarded)
    ) {
      return forwarded;
    }
  }
  if (trust.trustCloudflare) {
    const value = header(req, 'cf-connecting-ip');
    if (value && isIP(value)) return value;
  }
  return req.ip ?? 'unknown';
}

@Injectable()
export class ClientIpMiddleware implements NestMiddleware {
  private readonly trust: ClientIpTrust;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.trust = {
      trustCloudflare: config.get('TRUST_CLOUDFLARE', { infer: true }),
      proxySecret: config.get('INTERNAL_PROXY_SECRET', { infer: true }),
    };
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    req.clientIp = resolveClientIp(req, this.trust);
    next();
  }
}
