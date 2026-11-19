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
import { Throttle } from '@nestjs/throttler';
import type { CustomerLogoView, LogoDetail, LogoView } from '@forgea/types';
import { NewLogoDto, UpdateLogoDto } from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { Public, RequirePermission } from '../authorization/decorators.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { UploadSlots } from '../uploads/upload-slots.interceptor.js';
import {
  CUSTOMER_LOGO_MAX_BYTES,
  LOGO_SVG_MAX_BYTES,
  LogosService,
} from './logos.service.js';

@Controller('logos')
export class LogosController {
  constructor(private readonly logos: LogosService) {}

  @RequirePermission('catalog.view')
  @Get()
  list(): Promise<LogoView[]> {
    return this.logos.list();
  }

  /**
   * A customer's own logo, for their keychain or a product's logo slot: an SVG (their own, or
   * their picture traced in their browser), read into an outline; the file is never kept.
   * Anyone may bring one: visitors design before they have an account.
   */
  @Public()
  @Throttle(THROTTLE.upload)
  @Post('yours')
  @UseInterceptors(
    UploadSlots,
    FileInterceptor('file', {
      limits: { fileSize: CUSTOMER_LOGO_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  yours(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<CustomerLogoView> {
    return this.logos.createForCustomer(file?.buffer);
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
