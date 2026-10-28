import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthenticatedUser } from './authenticated-user.js';

export const IS_PUBLIC = 'forgea:isPublic';
export const ROLES = 'forgea:roles';

/**
 * Opens a route to anonymous visitors. Everything else requires a signed-in user,
 * so forgetting a decorator fails closed rather than open.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Restricts a route to these roles. ADMIN always passes (admins can do everything),
 * so `@Roles(Role.STAFF)` means "staff and admins".
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

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
