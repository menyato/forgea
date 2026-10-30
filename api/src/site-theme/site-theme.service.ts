import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  defaultPaletteName,
  isPalette,
  type Palette,
  PALETTE_KEYS,
  paletteChecks,
  palettes,
  type SavedThemeView,
  type SiteTheme,
} from '@forgea/brand';
import type {
  ApplyThemeDto,
  SaveNamedThemeDto,
  SaveSiteThemeDto,
} from '@forgea/validation';
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
    const palette = checkedPalette(dto.palette, dto.basedOn);
    const failing = paletteChecks(palette).filter((c) => !c.passes);
    // The owner may keep colours that fail, but only by confirming it (audit-logged).
    if (failing.length > 0 && !dto.allowLowContrast) {
      throw new BadRequestException(
        `Not readable enough: ${failing
          .map((c) => `${c.label} (${c.mode})`)
          .join(', ')}`,
      );
    }
    await this.themes.save(palette, dto.basedOn, adminId);
    return this.current();
  }

  /** Back to the default palette in packages/brand/src/tokens.ts. */
  async reset(): Promise<{ theme: SiteTheme | null }> {
    await this.themes.clear();
    return { theme: null };
  }

  /** The saved themes, marking the one the site uses now. */
  async saved(): Promise<SavedThemeView[]> {
    const [rows, { theme }] = await Promise.all([
      this.themes.savedList(),
      this.current(),
    ]);
    const now = theme?.palette ?? palettes[defaultPaletteName];
    // A row written by an older palette shape is left out rather than breaking the page.
    return rows.flatMap((r) =>
      isPalette(r.palette)
        ? [
            {
              id: r.id,
              name: r.name,
              palette: r.palette,
              basedOn: r.basedOn,
              live: samePalette(r.palette, now),
              createdAt: r.createdAt.toISOString(),
            },
          ]
        : [],
    );
  }

  /** Keeps a palette under a name; the site does not change until it is applied. */
  async keep(
    dto: SaveNamedThemeDto,
    adminId: string,
  ): Promise<SavedThemeView[]> {
    const palette = checkedPalette(dto.palette, dto.basedOn);
    await this.themes.keep(dto.name, palette, dto.basedOn, adminId);
    return this.saved();
  }

  /** The site switches to a saved theme for everyone, with the same readability rule. */
  async apply(
    id: string,
    dto: ApplyThemeDto,
    adminId: string,
  ): Promise<{ theme: SiteTheme | null }> {
    const row = await this.themes.savedOne(id);
    if (!row) throw new NotFoundException('Saved theme not found');
    return this.save(
      {
        palette: row.palette as Record<string, string>,
        basedOn: row.basedOn,
        ...(dto.allowLowContrast ? { allowLowContrast: true } : {}),
      },
      adminId,
    );
  }

  async forget(id: string): Promise<SavedThemeView[]> {
    if (!(await this.themes.forget(id)))
      throw new NotFoundException('Saved theme not found');
    return this.saved();
  }
}

const samePalette = (a: Palette, b: Palette) =>
  PALETTE_KEYS.every((k) => a[k].toLowerCase() === b[k].toLowerCase());

function checkedPalette(palette: unknown, basedOn: string): Palette {
  if (!isPalette(palette)) {
    throw new BadRequestException(
      'Every colour of the palette is needed, each as #rrggbb',
    );
  }
  if (basedOn !== 'custom' && !(basedOn in palettes)) {
    throw new BadRequestException('Unknown starting palette');
  }
  return palette;
}
