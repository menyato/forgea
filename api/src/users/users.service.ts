import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page, UserListItem } from '@forgea/types';
import type {
  AddTeamMemberDto,
  UpdateTeamMemberDto,
  UserListQuery,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import type { EnvironmentVariables } from '../config/environment.js';
import type { User } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { UsersRepository } from './users.repository.js';

/**
 * The team page. Staff and admins are Workspace accounts that sign in with Google only, so
 * the team is managed by address: an admin adds it, Google links it at the first sign-in.
 * Customer accounts are listed but never given a team role.
 */
@Injectable()
export class UsersService {
  private readonly workspaceDomain: string;

  constructor(
    private readonly users: UsersRepository,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.workspaceDomain = config.get('WORKSPACE_DOMAIN', { infer: true });
  }

  async list(query: UserListQuery): Promise<Page<UserListItem>> {
    return toPage(await this.users.list(query), toListItem);
  }

  async addTeamMember(dto: AddTeamMemberDto): Promise<UserListItem> {
    if (!dto.email.endsWith(`@${this.workspaceDomain}`)) {
      throw new BadRequestException(
        `Team members use their @${this.workspaceDomain} Workspace account`,
      );
    }
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('This address already has an account');
    }
    return toListItem(
      await this.users.createTeamMember({
        email: dto.email,
        name: dto.name ?? null,
        role: dto.role,
      }),
    );
  }

  async updateTeamMember(
    id: string,
    dto: UpdateTeamMemberDto,
    actorId: string,
  ): Promise<UserListItem> {
    if (id === actorId) {
      throw new BadRequestException(
        'You cannot change your own access; ask another admin',
      );
    }
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('Account not found');
    if (user.role === Role.CUSTOMER) {
      throw new BadRequestException(
        `Customer accounts cannot join the team; add their @${this.workspaceDomain} address instead`,
      );
    }
    return toListItem(
      await this.users.updateTeamMember(id, dto.role, dto.active),
    );
  }
}

function toListItem(u: User): UserListItem {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    signIn: [
      ...(u.googleId ? (['google'] as const) : []),
      ...(u.passwordHash ? (['password'] as const) : []),
    ],
    disabled: u.disabledAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}
