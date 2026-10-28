import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessTokenService } from './access-token.service.js';
import { AuthCookies } from './auth-cookies.js';
import { IS_PUBLIC } from './decorators.js';

/**
 * Global guard. Attaches `req.user` when the access cookie is valid, and rejects
 * anonymous requests unless the route is marked @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly cookies: AuthCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.cookies.access(req);
    const user = token ? await this.tokens.verify(token) : null;
    if (user) req.user = user;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic && !user) throw new UnauthorizedException();
    return true;
  }
}
