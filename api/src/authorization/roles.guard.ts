import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../generated/prisma/enums.js';
import { ROLES } from './decorators.js';

/**
 * Global guard, runs after JwtAuthGuard. Routes without @Roles() are open to any
 * signed-in user (customer routes then check ownership in their service).
 *
 * | Role     | Reaches                                                     |
 * |----------|-------------------------------------------------------------|
 * | ADMIN    | everything                                                  |
 * | STAFF    | routes marked @Roles(Role.STAFF): orders, print jobs        |
 * | DESIGNER | routes marked @Roles(Role.DESIGNER): catalog, 3D uploads    |
 * | CUSTOMER | unmarked routes, scoped to their own orders and cart        |
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    if (user && (user.role === Role.ADMIN || required.includes(user.role)))
      return true;
    throw new ForbiddenException('You do not have access to this');
  }
}
