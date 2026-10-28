import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { CatalogFile, CatalogImportReport } from '@forgea/types';
import type { Response } from 'express';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { CatalogExporter } from './catalog-exporter.service.js';
import {
  CatalogImporter,
  type ImportMode,
} from './catalog-importer.service.js';

const MB = 1024 * 1024;
/** A catalog file carries every 3D model and photo, base64-encoded. */
const CATALOG_FILE_MAX = 300 * MB;

/** Moving the catalog between installations (e.g. from local to the deployed site). Admin only. */
@Roles(Role.ADMIN)
@Controller('catalog-transfer')
export class CatalogTransferController {
  constructor(
    private readonly exporter: CatalogExporter,
    private readonly importer: CatalogImporter,
  ) {}

  @Audit({
    action: 'catalog.export',
    targetType: 'Catalog',
    targetId: 'catalog',
  })
  @Get('export')
  async export(
    @Res({ passthrough: true }) res: Response,
  ): Promise<CatalogFile> {
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="forgea-catalog-${day}.json"`,
    );
    return this.exporter.export();
  }

  /** The file as an upload; `?mode=update` also overwrites entries that already exist. */
  @Audit({
    action: 'catalog.import',
    targetType: 'Catalog',
    targetId: 'catalog',
  })
  @HttpCode(200)
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: CATALOG_FILE_MAX, files: 1, fields: 0 },
    }),
  )
  import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('mode') mode: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CatalogImportReport> {
    if (!file) throw new BadRequestException('Choose a catalog file');
    if (mode !== undefined && mode !== 'add' && mode !== 'update') {
      throw new BadRequestException('mode is "add" or "update"');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('This file is not valid JSON');
    }
    return this.importer.import(parsed, (mode ?? 'add') as ImportMode, user.id);
  }
}
