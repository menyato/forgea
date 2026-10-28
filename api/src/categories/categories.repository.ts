import { Injectable } from '@nestjs/common';
import type { SaveCategoryDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Category } from '../generated/prisma/client.js';

const ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }] as const;

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(activeOnly: boolean): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [...ORDER],
    });
  }

  create(dto: SaveCategoryDto): Promise<Category> {
    return this.prisma.category.create({ data: fields(dto) });
  }

  update(id: string, dto: SaveCategoryDto): Promise<Category> {
    return this.prisma.category.update({ where: { id }, data: fields(dto) });
  }
}

const fields = (dto: SaveCategoryDto) => ({
  slug: dto.slug,
  name: dto.name,
  description: dto.description ?? null,
  sortOrder: dto.sortOrder,
  active: dto.active,
});
