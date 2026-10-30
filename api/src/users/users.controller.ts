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
import type { Page, TeamAccess, UserListItem } from '@forgea/types';
import {
  AddTeamMemberDto,
  SaveTeamAccessDto,
  UpdateTeamMemberDto,
  UserListQuery,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { AdminOnly, CurrentUser } from '../authorization/decorators.js';
import { TeamAccessService } from './team-access.service.js';
import { UsersService } from './users.service.js';

/** Accounts and the team. Admin only; every change is audit-logged. */
@AdminOnly()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly access: TeamAccessService,
  ) {}

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

  @Get(':id/access')
  memberAccess(@Param('id', ParseUUIDPipe) id: string): Promise<TeamAccess> {
    return this.access.access(id);
  }

  /** Permissions given or taken away on top of their role; applies to their next request. */
  @Audit({ action: 'user.access.update', targetType: 'User' })
  @Put(':id/access')
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveTeamAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TeamAccess> {
    return this.access.setAccess(id, dto, user.id);
  }
}
