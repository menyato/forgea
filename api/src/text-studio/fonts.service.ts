import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FontView } from '@forgea/types';
import type { SaveFontDto, UpdateFontDto } from '@forgea/validation';
import { UploadPurpose } from '../generated/prisma/enums.js';
import type { Font } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { FontsRepository } from './fonts.repository.js';
import { TextShaper } from './text-shaper.js';

/** The fonts customers write their text in (Dashboard → Fonts). */
@Injectable()
export class FontsService {
  constructor(
    private readonly fonts: FontsRepository,
    private readonly uploads: UploadsService,
    private readonly shaper: TextShaper,
  ) {}

  async list(): Promise<FontView[]> {
    return (await this.fonts.all()).map(toView);
  }

  /**
   * A font from an uploaded file: read in the worker (never on the main thread), which tells
   * its name and whether it writes English and Arabic. A file that writes neither is refused.
   */
  async create(dto: SaveFontDto): Promise<FontView> {
    await this.uploads.requireClean([dto.fileKey], UploadPurpose.FONT);
    const scripts = await this.shaper.scripts(
      await this.uploads.read(dto.fileKey),
    );
    if (!scripts) throw new BadRequestException("This font can't be read");
    if (!scripts.latin && !scripts.arabic) {
      throw new BadRequestException(
        'This font has neither English nor Arabic letters',
      );
    }
    const name = (dto.name || scripts.name || 'Font').trim().slice(0, 60);
    if (await this.fonts.findByName(name)) {
      throw new ConflictException(`There is already a font called ${name}`);
    }
    return toView(
      await this.fonts.create({
        name,
        fileKey: dto.fileKey,
        latin: scripts.latin,
        arabic: scripts.arabic,
        sortOrder: (await this.fonts.all()).length,
      }),
    );
  }

  /** Renamed, reordered or switched off (a font is never deleted: orders use it). */
  async update(id: string, dto: UpdateFontDto): Promise<FontView> {
    try {
      return toView(await this.fonts.update(id, dto));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Font not found');
        if (error.code === 'P2002')
          throw new ConflictException(
            `There is already a font called ${dto.name}`,
          );
      }
      throw error;
    }
  }
}

function toView(f: Font): FontView {
  return {
    id: f.id,
    name: f.name,
    fileKey: f.fileKey,
    latin: f.latin,
    arabic: f.arabic,
    active: f.active,
    sortOrder: f.sortOrder,
  };
}
