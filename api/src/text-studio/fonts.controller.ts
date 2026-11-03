import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { FontView } from '@forgea/types';
import { SaveFontDto, UpdateFontDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { RequirePermission } from '../authorization/decorators.js';
import { FontsService } from './fonts.service.js';

@Controller('fonts')
export class FontsController {
  constructor(private readonly fonts: FontsService) {}

  @RequirePermission('catalog.view')
  @Get()
  list(): Promise<FontView[]> {
    return this.fonts.list();
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'font.create', targetType: 'Font' })
  @Post()
  create(@Body() dto: SaveFontDto): Promise<FontView> {
    return this.fonts.create(dto);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'font.update', targetType: 'Font' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFontDto,
  ): Promise<FontView> {
    return this.fonts.update(id, dto);
  }
}
