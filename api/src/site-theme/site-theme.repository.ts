import { Injectable } from '@nestjs/common';
import type { Palette } from '@forgea/brand';
import { PrismaService } from '../database/prisma.service.js';
import type {
  Prisma,
  SavedTheme,
  SiteTheme,
} from '../generated/prisma/client.js';

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

  savedList(): Promise<SavedTheme[]> {
    return this.prisma.savedTheme.findMany({ orderBy: { name: 'asc' } });
  }

  savedOne(id: string): Promise<SavedTheme | null> {
    return this.prisma.savedTheme.findUnique({ where: { id } });
  }

  /** Under an existing name, replaces that theme's colours. */
  async keep(name: string, palette: Palette, basedOn: string, adminId: string) {
    const data = {
      palette: { ...palette } as Prisma.InputJsonObject,
      basedOn,
      createdById: adminId,
    };
    await this.prisma.savedTheme.upsert({
      where: { name },
      update: data,
      create: { name, ...data },
    });
  }

  /** False when it was already gone. */
  async forget(id: string): Promise<boolean> {
    return (
      (await this.prisma.savedTheme.deleteMany({ where: { id } })).count > 0
    );
  }
}
