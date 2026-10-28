import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Session } from '../generated/prisma/client.js';

export interface NewSession {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Data access for refresh-token sessions. */
@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { tokenHash } });
  }

  async create(data: NewSession): Promise<void> {
    await this.prisma.session.create({
      data: { ...data, ipAddress: inet(data.ipAddress) },
    });
  }

  /**
   * Atomically revokes `oldId` and creates its replacement. Returns false when `oldId` was
   * already revoked by a concurrent request — the caller treats that as token reuse.
   */
  rotate(oldId: string, replacement: NewSession): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: oldId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) return false;
      await tx.session.create({
        data: { ...replacement, ipAddress: inet(replacement.ipAddress) },
      });
      return true;
    });
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

/** The column is INET; anything that isn't an address is stored as null. */
function inet(ip: string | null): string | null {
  return ip !== null && /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}
