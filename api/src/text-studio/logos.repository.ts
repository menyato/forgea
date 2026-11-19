import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Logo, Prisma } from '../generated/prisma/client.js';

const ORDER = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

@Injectable()
export class LogosRepository {
  constructor(private readonly prisma: PrismaService) {}

  all(): Promise<Logo[]> {
    return this.prisma.logo.findMany({ orderBy: ORDER });
  }

  /** Only these logos, active or not (a product keeps the logos its slots use). */
  byIds(ids: readonly string[]): Promise<Logo[]> {
    return ids.length
      ? this.prisma.logo.findMany({ where: { id: { in: [...ids] } } })
      : Promise.resolve([]);
  }

  findByName(name: string): Promise<Logo | null> {
    return this.prisma.logo.findUnique({ where: { name } });
  }

  count(): Promise<number> {
    return this.prisma.logo.count();
  }

  create(data: {
    name: string;
    outline: Prisma.InputJsonValue;
    points: number;
    sortOrder: number;
  }): Promise<Logo> {
    return this.prisma.logo.create({ data });
  }

  update(
    id: string,
    data: { name: string; active: boolean; sortOrder: number },
  ): Promise<Logo> {
    return this.prisma.logo.update({ where: { id }, data });
  }
}
