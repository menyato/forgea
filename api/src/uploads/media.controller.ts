import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { isMediaKey } from '@forgea/validation';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { OptionalUser, Public } from '../authorization/decorators.js';
import { TeamPermissions } from '../authorization/team-permissions.js';
import { Role } from '../generated/prisma/enums.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { UploadsService } from './uploads.service.js';

/** "Save as" with the original name: ASCII for old clients, UTF-8 (RFC 5987) for the rest. */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Serves accepted files (product models and photos) to the storefront's server, which relays
 * them to browsers. The access rules live here, never in a public URL.
 */
@Public()
@Throttle(THROTTLE.media)
@Controller('media')
export class MediaController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly team: TeamPermissions,
  ) {}

  @Get('clean/:file')
  async file(
    @Param('file') file: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) res: Response,
    /** "1": as a download under its original name (the dashboard's Download button; staff). */
    @Query('download') download?: string,
  ): Promise<StreamableFile> {
    const key = `clean/${file}`;
    if (!isMediaKey(key)) throw new NotFoundException('File not found');
    // A team member's access as it is now (not as their token says): switched off or a
    // permission taken away applies to their next file.
    const access =
      user !== undefined && user.role !== Role.CUSTOMER
        ? await this.team.current(user.id)
        : null;
    const permissions =
      access && !access.disabled && access.role !== Role.CUSTOMER
        ? access.permissions
        : null;
    const staff = permissions !== null;
    const media = await this.uploads.media(key, {
      staff: permissions,
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
      disposition:
        download === '1' && staff ? attachment(media.name) : 'inline',
    });
  }
}
