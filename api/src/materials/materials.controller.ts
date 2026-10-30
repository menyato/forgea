import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { MaterialView } from '@forgea/types';
import { SaveMaterialDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { RequirePermission } from '../authorization/decorators.js';
import { MaterialsService } from './materials.service.js';

/** Material prices are cost data: admin only, never public. Audit-logged. */
@RequirePermission('materials.manage')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  /** Designers (products) and staff (the production planner) read materials; only admins change what they cost. */
  @RequirePermission('materials.view')
  @Get()
  list(): Promise<MaterialView[]> {
    return this.materials.list();
  }

  @Audit({ action: 'material.create', targetType: 'Material' })
  @Post()
  create(@Body() dto: SaveMaterialDto): Promise<MaterialView> {
    return this.materials.create(dto);
  }

  @Audit({ action: 'material.update', targetType: 'Material' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMaterialDto,
  ): Promise<MaterialView> {
    return this.materials.update(id, dto);
  }
}
