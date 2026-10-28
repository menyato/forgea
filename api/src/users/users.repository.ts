import { Injectable } from '@nestjs/common';
import type { UserListQuery } from '@forgea/validation';
import { keysetPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

export interface NewCustomer {
  email: string;
  name?: string | undefined;
  passwordHash?: string;
  googleId?: string;
  emailVerifiedAt?: Date;
}

/** Data access for users. Emails must already be normalized by the caller. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  createCustomer(data: NewCustomer): Promise<User> {
    return this.prisma.user.create({ data: { ...data, role: Role.CUSTOMER } });
  }

  createBootstrapAdmin(data: {
    email: string;
    name?: string | undefined;
    googleId: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: { ...data, role: Role.ADMIN, emailVerifiedAt: new Date() },
    });
  }

  /**
   * Links a Google account. When the existing account's email was never verified, its
   * password is removed: someone may have registered the address before its real owner
   * (account pre-hijacking), and Google has now proven who owns it.
   */
  linkGoogle(user: User, googleId: string): Promise<User> {
    const unverified = user.emailVerifiedAt === null;
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        googleId,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        ...(unverified && user.passwordHash ? { passwordHash: null } : {}),
      },
    });
  }

  /** The name and phone given at checkout, kept for the next order and for delivery calls. */
  updateContact(
    id: string,
    contact: { name: string; phone: string },
  ): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: contact });
  }

  /** Accounts for the team page, newest first; filter by role, search email or name. */
  list(query: UserListQuery) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q.toLowerCase() } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return keysetPage<User>(
      {
        sortField: 'createdAt',
        kind: 'date',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (row) => row.createdAt,
      },
      ({ after, orderBy, take }) =>
        this.prisma.user.findMany({
          where: { AND: [where, after as Prisma.UserWhereInput] },
          orderBy: orderBy as Prisma.UserOrderByWithRelationInput[],
          take,
        }),
    );
  }

  /** A Workspace account added by an admin; Google links it at their first sign-in. */
  createTeamMember(data: {
    email: string;
    name: string | null;
    role: Role;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  /** Active admins other than `exceptId`: the team must always keep one. */
  countOtherActiveAdmins(exceptId: string): Promise<number> {
    return this.prisma.user.count({
      where: { role: Role.ADMIN, disabledAt: null, id: { not: exceptId } },
    });
  }

  /**
   * Changes a team member's role and access. A change ends every session they have, in the
   * same transaction, so the new role (or the lockout) applies at their next sign-in.
   */
  updateTeamMember(id: string, role: Role, active: boolean): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id } });
      const user = await tx.user.update({
        where: { id },
        data: {
          role,
          disabledAt: active ? null : (current.disabledAt ?? new Date()),
        },
      });
      if (!active || role !== current.role) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return user;
    });
  }

  markEmailVerified(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async adminExists(): Promise<boolean> {
    return (await this.prisma.user.count({ where: { role: Role.ADMIN } })) > 0;
  }
}
