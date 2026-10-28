import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Page, UserListItem } from '@forgea/types';
import {
  AddTeamMemberDto,
  UpdateTeamMemberDto,
  UserListQuery,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { UsersService } from './users.service.js';

/** Accounts and the team. Admin only; every change is audit-logged. */
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: UserListQuery): Promise<Page<UserListItem>> {
    return this.users.list(query);
  }

  @Audit({ action: 'user.team.add', targetType: 'User' })
  @Post('team')
  add(@Body() dto: AddTeamMemberDto): Promise<UserListItem> {
    return this.users.addTeamMember(dto);
  }

  @Audit({ action: 'user.team.update', targetType: 'User' })
  @Put(':id/team')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserListItem> {
    return this.users.updateTeamMember(id, dto, user.id);
  }
}
