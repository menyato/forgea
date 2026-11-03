import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Font } from '../generated/prisma/client.js';

const ORDER = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

@Injectable()
export class FontsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The fonts customers choose from. */
  active(): Promise<Font[]> {
    return this.prisma.font.findMany({
      where: { active: true },
      orderBy: ORDER,
    });
  }

  all(): Promise<Font[]> {
    return this.prisma.font.findMany({ orderBy: ORDER });
  }

  findByName(name: string): Promise<Font | null> {
    return this.prisma.font.findUnique({ where: { name } });
  }

  create(data: {
    name: string;
    fileKey: string;
    latin: boolean;
    arabic: boolean;
    sortOrder: number;
  }): Promise<Font> {
    return this.prisma.font.create({ data });
  }

  update(
    id: string,
    data: { name: string; active: boolean; sortOrder: number },
  ): Promise<Font> {
    return this.prisma.font.update({ where: { id }, data });
  }
}
