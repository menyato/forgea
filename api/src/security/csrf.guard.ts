import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { HTTP } from '@forgea/types';
import { OriginPolicy } from './origin-policy.js';

/** Every state-changing request must carry this header with the value "1". */
export const CSRF_HEADER = HTTP.CSRF_HEADER;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth, on top of SameSite=Lax auth cookies (never sent on cross-site posts):
 * 1. A custom header is required. HTML forms can't set one, and cross-origin scripts
 *    can't either without a CORS preflight, which the allowlist refuses.
 * 2. If the browser sends Origin, it must be on the allowlist.
 * 3. If the browser says the request is cross-site (Sec-Fetch-Site), it is refused.
 * GET requests must never change state, so they are not checked.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly origins: OriginPolicy) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    if (req.get(CSRF_HEADER) !== '1') {
      throw new ForbiddenException('Missing CSRF header');
    }
    const origin = req.get('origin');
    if (origin !== undefined && !this.origins.isAllowed(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
      throw new ForbiddenException('Cross-site request refused');
    }
    return true;
  }
}
