import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../generated/prisma/enums.js';
import { ACCESS, type Access } from './decorators.js';
import { TeamPermissions } from './team-permissions.js';

/**
 * Global guard, runs after JwtAuthGuard. Routes without @RequirePermission() or @AdminOnly()
 * are open to any signed-in user (customer routes then check ownership in their service).
 *
 * For the others the caller's role, permissions and "switched off" flag are read from the
 * database, never trusted from the access token, so an admin's change applies at once:
 *
 * | Caller                         | Reaches                                         |
 * |--------------------------------|-------------------------------------------------|
 * | ADMIN                          | everything                                      |
 * | STAFF / DESIGNER               | routes needing a permission they hold           |
 * | CUSTOMER, switched off, unknown| nothing here                                    |
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly team: TeamPermissions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Access | undefined>(
      ACCESS,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    const access = user ? await this.team.current(user.id) : null;
    if (user && access && !access.disabled) {
      // Handlers see the role as it is now, not as it was at sign-in.
      req.user = { id: user.id, role: access.role };
      req.permissions = access.permissions;
      if (access.role === Role.ADMIN) return true;
      if (required !== 'admin' && access.permissions.includes(required))
        return true;
    }
    throw new ForbiddenException('You do not have access to this');
  }
}
