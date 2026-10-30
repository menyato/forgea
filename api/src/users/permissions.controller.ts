import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { RolePermissionsView } from '@forgea/types';
import { SaveRolePermissionsDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { AdminOnly, CurrentUser } from '../authorization/decorators.js';
import { TeamAccessService } from './team-access.service.js';

/** What each team role may do. Admin only; every change is audit-logged. */
@AdminOnly()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly access: TeamAccessService) {}

  @Get('roles')
  roles(): Promise<RolePermissionsView[]> {
    return this.access.roles();
  }

  @Audit({
    action: 'role.permissions.update',
    targetType: 'Role',
    targetParam: 'role',
  })
  @Put('roles/:role')
  setRole(
    @Param('role') role: string,
    @Body() dto: SaveRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RolePermissionsView[]> {
    return this.access.setRole(role, dto, user.id);
  }
}
