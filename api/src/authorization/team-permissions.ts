import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ROLE_PERMISSIONS,
  effectivePermissions,
  type Permission,
  type PermissionRole,
  TEAM_ROLES_WITH_PERMISSIONS,
} from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import type { User } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';

type PermissionHolder = Pick<
  User,
  'role' | 'grantedPermissions' | 'deniedPermissions'
>;

/** Someone's access as the database says right now, not as their sign-in token remembers. */
export interface CurrentAccess {
  role: Role;
  disabled: boolean;
  permissions: Permission[];
}

const hasOwnPermissions = (role: Role): role is PermissionRole =>
  (TEAM_ROLES_WITH_PERMISSIONS as readonly Role[]).includes(role);

/**
 * What each team member may do, read from the database on every check: an admin's change (a
 * role's permissions, a person's grants and denials, a role change, switching someone off)
 * applies to their very next request, with no cache to clear and no new sign-in needed.
 */
@Injectable()
export class TeamPermissions {
  constructor(private readonly prisma: PrismaService) {}

  /** A role's permissions as the admin set them (the defaults until then). */
  async ofRole(role: PermissionRole): Promise<string[]> {
    const row = await this.prisma.rolePermissions.findUnique({
      where: { role },
    });
    return row?.permissions ?? [...DEFAULT_ROLE_PERMISSIONS[role]];
  }

  async of(user: PermissionHolder): Promise<Permission[]> {
    const fromRole = hasOwnPermissions(user.role)
      ? await this.ofRole(user.role)
      : [];
    return effectivePermissions(
      user.role,
      fromRole,
      user.grantedPermissions,
      user.deniedPermissions,
    );
  }

  /** Null for an account that no longer exists. */
  async current(userId: string): Promise<CurrentAccess | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        disabledAt: true,
        grantedPermissions: true,
        deniedPermissions: true,
      },
    });
    if (!user) return null;
    return {
      role: user.role,
      disabled: user.disabledAt !== null,
      permissions: await this.of(user),
    };
  }
}
