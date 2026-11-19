import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { LogoDetail, LogoView } from '@forgea/types';
import { NewLogoDto, UpdateLogoDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { RequirePermission } from '../authorization/decorators.js';
import { LOGO_SVG_MAX_BYTES, LogosService } from './logos.service.js';

@Controller('logos')
export class LogosController {
  constructor(private readonly logos: LogosService) {}

  @RequirePermission('catalog.view')
  @Get()
  list(): Promise<LogoView[]> {
    return this.logos.list();
  }

  /** One logo with its outline (the dashboard draws it). */
  @RequirePermission('catalog.view')
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string): Promise<LogoDetail> {
    return this.logos.one(id);
  }

  /** A new logo from an SVG drawing (the file is read into outlines, never kept). */
  @RequirePermission('catalog.manage')
  @Audit({ action: 'logo.create', targetType: 'Logo' })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LOGO_SVG_MAX_BYTES, files: 1, fields: 2 },
    }),
  )
  create(
    @Body() dto: NewLogoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<LogoView> {
    return this.logos.create(dto.name, file?.buffer);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'logo.update', targetType: 'Logo' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogoDto,
  ): Promise<LogoView> {
    return this.logos.update(id, dto);
  }
}
