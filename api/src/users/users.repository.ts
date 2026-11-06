import { BadRequestException, Injectable } from '@nestjs/common';
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
   * Links a Google account. When the existing account's email was never verified, someone may
   * have registered the address before its real owner (account pre-hijacking), and Google has
   * now proven who owns it: the password is removed and every session started with it ends,
   * in the same transaction, so whoever registered it is signed out for good.
   */
  async linkGoogle(user: User, googleId: string): Promise<User> {
    const unverified = user.emailVerifiedAt === null;
    return this.prisma.$transaction(async (tx) => {
      if (unverified) {
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return tx.user.update({
        where: { id: user.id },
        data: {
          googleId,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          ...(unverified && user.passwordHash ? { passwordHash: null } : {}),
        },
      });
    });
  }

  /**
   * A new password, set from a reset link or the account page; every session ends, so a
   * stolen one stops working too. `proven`: the address was proven (the reset link was emailed
   * there), so it is confirmed. Knowing the old password proves nothing about the address:
   * whoever registered it before its real owner knows that password too.
   */
  setPassword(
    id: string,
    passwordHash: string,
    proven: boolean,
  ): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id } });
      return tx.user.update({
        where: { id },
        data: {
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? (proven ? new Date() : null),
        },
      });
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

  /**
   * Changes a team member's role and access. A change ends every session they have, in the
   * same transaction, so the new role (or the lockout) applies at their next sign-in.
   */
  updateTeamMember(id: string, role: Role, active: boolean): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      // Every active admin locked first: two admins taking each other's role at once can't
      // both see the other still there and leave the team with none.
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "users"
        WHERE "role" = 'ADMIN' AND "disabledAt" IS NULL
        ORDER BY "id" FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id } });
      const losesAdmin =
        current.role === Role.ADMIN &&
        current.disabledAt === null &&
        (role !== Role.ADMIN || !active);
      if (losesAdmin && admins.every((a) => a.id === id))
        throw new BadRequestException('The team must keep at least one admin');
      const user = await tx.user.update({
        where: { id },
        data: {
          role,
          disabledAt: active ? null : (current.disabledAt ?? new Date()),
          // A new role starts from that role's permissions, without the old one's exceptions.
          ...(role !== current.role
            ? { grantedPermissions: [], deniedPermissions: [] }
            : {}),
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

  /** A team member's own permission changes on top of their role (checked by the service). */
  /** Only while they still have `role` (a role change meanwhile resets their exceptions). */
  async setAccess(
    id: string,
    role: Role,
    granted: string[],
    denied: string[],
  ): Promise<User | null> {
    const { count } = await this.prisma.user.updateMany({
      where: { id, role },
      data: { grantedPermissions: granted, deniedPermissions: denied },
    });
    return count === 1 ? this.prisma.user.findUnique({ where: { id } }) : null;
  }

  /** What one role may do; the next request of everyone with that role uses it. */
  async setRolePermissions(
    role: Role,
    permissions: string[],
    updatedById: string,
  ): Promise<void> {
    await this.prisma.rolePermissions.upsert({
      where: { role },
      create: { role, permissions, updatedById },
      update: { permissions, updatedById },
    });
  }

  /** Active team members per role, for the Roles & permissions page. */
  async activeMembersByRole(): Promise<Map<Role, number>> {
    const rows = await this.prisma.user.groupBy({
      by: ['role'],
      where: { disabledAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.role, r._count._all]));
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
