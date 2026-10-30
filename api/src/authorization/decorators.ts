import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '@forgea/types';
import type { AuthenticatedUser } from './authenticated-user.js';

export const IS_PUBLIC = 'forgea:isPublic';
export const ACCESS = 'forgea:access';

/** A permission from @forgea/types, or 'admin' for what only admins may do. */
export type Access = Permission | 'admin';

/**
 * Opens a route to anonymous visitors. Everything else requires a signed-in user,
 * so forgetting a decorator fails closed rather than open.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Restricts a route to team members holding this permission (PermissionsGuard). Admins hold
 * every permission. On a method it replaces the class's, so a controller can be 'admin' with
 * one route open to a permission.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(ACCESS, permission satisfies Access);

/** Only admins: the team, permissions themselves. Never a permission anyone can be given. */
export const AdminOnly = () => SetMetadata(ACCESS, 'admin' satisfies Access);

/** The signed-in user. Throws on public routes when nobody is signed in. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw new UnauthorizedException();
    return user;
  },
);

/** The signed-in user if any; for public routes that behave differently when signed in. */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest<Request>().user,
);

/**
 * What the caller may do, as PermissionsGuard just read it from the database. Only on routes
 * that need a permission (elsewhere it is empty); for leaving out what they may not see.
 */
export const CallerPermissions = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Permission[] =>
    ctx.switchToHttp().getRequest<Request>().permissions ?? [],
);
