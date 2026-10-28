import { Injectable } from '@nestjs/common';
import type { CategoryView } from '@forgea/types';
import type { SaveCategoryDto } from '@forgea/validation';
import type { Category } from '../generated/prisma/client.js';
import { CategoriesRepository } from './categories.repository.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly categories: CategoriesRepository) {}

  async list(activeOnly: boolean): Promise<CategoryView[]> {
    return (await this.categories.list(activeOnly)).map(toView);
  }

  async create(dto: SaveCategoryDto): Promise<CategoryView> {
    return toView(await this.categories.create(dto));
  }

  async update(id: string, dto: SaveCategoryDto): Promise<CategoryView> {
    return toView(await this.categories.update(id, dto));
  }
}

function toView(c: Category): CategoryView {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    sortOrder: c.sortOrder,
    active: c.active,
  };
}
