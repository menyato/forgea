import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  effectivePermissions,
  isPermission,
  type Permission,
  type PermissionRole,
  type RolePermissionsView,
  TEAM_ROLES_WITH_PERMISSIONS,
  type TeamAccess,
} from '@forgea/types';
import type {
  SaveRolePermissionsDto,
  SaveTeamAccessDto,
} from '@forgea/validation';
import { TeamPermissions } from '../authorization/team-permissions.js';
import type { User } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { UsersRepository } from './users.repository.js';

const known = (keys: readonly string[]): Permission[] =>
  keys.filter(isPermission);

const isPermissionRole = (role: string): role is PermissionRole =>
  (TEAM_ROLES_WITH_PERMISSIONS as readonly string[]).includes(role);

/**
 * "Roles & permissions" and each team member's access page (admins only, every change
 * audit-logged). Admins hold everything and customers nothing, so only staff and designers
 * have permissions to edit, and nobody edits their own: another admin has to.
 */
@Injectable()
export class TeamAccessService {
  constructor(
    private readonly users: UsersRepository,
    private readonly team: TeamPermissions,
  ) {}

  async access(id: string): Promise<TeamAccess> {
    const user = await this.users.findById(id);
    if (!user || user.role === Role.CUSTOMER) {
      throw new NotFoundException('Team member not found');
    }
    return this.view(user);
  }

  async setAccess(
    id: string,
    dto: SaveTeamAccessDto,
    actorId: string,
  ): Promise<TeamAccess> {
    if (id === actorId) {
      throw new BadRequestException(
        'You cannot change your own access; ask another admin',
      );
    }
    const user = await this.users.findById(id);
    if (!user || user.role === Role.CUSTOMER) {
      throw new NotFoundException('Team member not found');
    }
    if (!isPermissionRole(user.role)) {
      throw new BadRequestException(
        'Admins can do everything; change their role to limit what they see',
      );
    }
    const both = dto.granted.filter((p) => dto.denied.includes(p));
    if (both.length > 0) {
      throw new BadRequestException(
        `A permission cannot be both given and taken away: ${both.join(', ')}`,
      );
    }
    return this.view(await this.users.setAccess(id, dto.granted, dto.denied));
  }

  async roles(): Promise<RolePermissionsView[]> {
    const members = await this.users.activeMembersByRole();
    return Promise.all(
      TEAM_ROLES_WITH_PERMISSIONS.map(async (role) => ({
        role,
        permissions: known(await this.team.ofRole(role)),
        members: members.get(role) ?? 0,
      })),
    );
  }

  async setRole(
    role: string,
    dto: SaveRolePermissionsDto,
    actorId: string,
  ): Promise<RolePermissionsView[]> {
    if (!isPermissionRole(role)) {
      throw new BadRequestException(
        'Only the staff and designer roles have permissions to edit',
      );
    }
    await this.users.setRolePermissions(role, dto.permissions, actorId);
    return this.roles();
  }

  private async view(user: User): Promise<TeamAccess> {
    const rolePermissions = isPermissionRole(user.role)
      ? known(await this.team.ofRole(user.role))
      : [];
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      disabled: user.disabledAt !== null,
      rolePermissions,
      granted: known(user.grantedPermissions),
      denied: known(user.deniedPermissions),
      permissions: effectivePermissions(
        user.role,
        rolePermissions,
        user.grantedPermissions,
        user.deniedPermissions,
      ),
    };
  }
}
