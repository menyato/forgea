import { BadRequestException, Injectable } from '@nestjs/common';
import {
  isPalette,
  type Palette,
  paletteChecks,
  palettes,
  type SiteTheme,
} from '@forgea/brand';
import type { SaveSiteThemeDto } from '@forgea/validation';
import { SiteThemeRepository } from './site-theme.repository.js';

/**
 * The palette the owner picks for the site and the logo. A palette that fails the readability
 * checks the built-in palettes pass (light and dark) is stored only when the owner confirms it.
 */
@Injectable()
export class SiteThemeService {
  constructor(private readonly themes: SiteThemeRepository) {}

  async current(): Promise<{ theme: SiteTheme | null }> {
    const row = await this.themes.get();
    // A row written by an older palette shape is ignored rather than breaking every page.
    if (!row || !isPalette(row.palette)) return { theme: null };
    return {
      theme: {
        palette: row.palette,
        basedOn: row.basedOn,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  async save(
    dto: SaveSiteThemeDto,
    adminId: string,
  ): Promise<{ theme: SiteTheme | null }> {
    if (!isPalette(dto.palette)) {
      throw new BadRequestException(
        'Every colour of the palette is needed, each as #rrggbb',
      );
    }
    if (dto.basedOn !== 'custom' && !(dto.basedOn in palettes)) {
      throw new BadRequestException('Unknown starting palette');
    }
    const failing = paletteChecks(dto.palette).filter((c) => !c.passes);
    // The owner may keep colours that fail, but only by confirming it (audit-logged).
    if (failing.length > 0 && !dto.allowLowContrast) {
      throw new BadRequestException(
        `Not readable enough: ${failing
          .map((c) => `${c.label} (${c.mode})`)
          .join(', ')}`,
      );
    }
    await this.themes.save(dto.palette satisfies Palette, dto.basedOn, adminId);
    return this.current();
  }

  /** Back to the default palette in packages/brand/src/tokens.ts. */
  async reset(): Promise<{ theme: SiteTheme | null }> {
    await this.themes.clear();
    return { theme: null };
  }
}
