import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { isMediaKey } from '@forgea/validation';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { OptionalUser, Public } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { UploadsService } from './uploads.service.js';

/**
 * Serves accepted files (product models and photos) to the storefront's server, which relays
 * them to browsers. The access rules live here, never in a public URL.
 */
@Public()
@Controller('media')
export class MediaController {
  constructor(private readonly uploads: UploadsService) {}

  @Get('clean/:file')
  async file(
    @Param('file') file: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const key = `clean/${file}`;
    if (!isMediaKey(key)) throw new NotFoundException('File not found');
    const staff = user !== undefined && user.role !== Role.CUSTOMER;
    const media = await this.uploads.media(key, {
      staff,
      userId: user?.id ?? null,
    });
    // Keys are random and never reused, so a file's bytes never change.
    res.setHeader(
      'Cache-Control',
      // Shared caches may keep only product files: nobody else's request is ever cached. A
      // day, not forever: once a product is hidden, its files stop being served within a day.
      staff || user ? 'private, max-age=3600' : 'public, max-age=86400',
    );
    return new StreamableFile(media.stream, {
      type: media.mimeType,
      length: media.size,
      disposition: 'inline',
    });
  }
}
