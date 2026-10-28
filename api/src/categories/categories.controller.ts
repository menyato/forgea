import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { CategoryView } from '@forgea/types';
import { SaveCategoryDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { Public, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { CategoriesService } from './categories.service.js';

/** Shop sections. The catalog is the owner's: changes are admin-only and audit-logged. */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Public: the shop's category filter (active categories only). */
  @Public()
  @Get()
  list(): Promise<CategoryView[]> {
    return this.categories.list(true);
  }

  /** Dashboard: every category, hidden ones included. */
  @Roles(Role.DESIGNER)
  @Get('manage')
  manage(): Promise<CategoryView[]> {
    return this.categories.list(false);
  }

  @Roles(Role.DESIGNER)
  @Audit({ action: 'category.create', targetType: 'Category' })
  @Post()
  create(@Body() dto: SaveCategoryDto): Promise<CategoryView> {
    return this.categories.create(dto);
  }

  @Roles(Role.DESIGNER)
  @Audit({ action: 'category.update', targetType: 'Category' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveCategoryDto,
  ): Promise<CategoryView> {
    return this.categories.update(id, dto);
  }
}
