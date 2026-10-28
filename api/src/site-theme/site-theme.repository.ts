import { Injectable } from '@nestjs/common';
import type { Palette } from '@forgea/brand';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, SiteTheme } from '../generated/prisma/client.js';

/** At most one row (id = 1); none means the default palette. */
const SINGLETON = { id: 1 } as const;

@Injectable()
export class SiteThemeRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(): Promise<SiteTheme | null> {
    return this.prisma.siteTheme.findUnique({ where: SINGLETON });
  }

  async save(palette: Palette, basedOn: string, adminId: string) {
    const data = {
      palette: { ...palette } as Prisma.InputJsonObject,
      basedOn,
      updatedByUserId: adminId,
    };
    await this.prisma.siteTheme.upsert({
      where: SINGLETON,
      update: data,
      create: { ...SINGLETON, ...data },
    });
  }

  async clear(): Promise<void> {
    await this.prisma.siteTheme.deleteMany({ where: SINGLETON });
  }
}
