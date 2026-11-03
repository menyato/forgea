import type * as HarfBuzz from 'harfbuzzjs';
import { isArabic } from './design.js';
import {
  type Bounds,
  boundsOf,
  contoursFromPath,
  mapRegions,
  type Region,
  regionsOf,
} from './outline.js';

/** HarfBuzz is WebAssembly (~440 KB): loaded on first use, once. */
let module: Promise<typeof HarfBuzz> | undefined;
const harfbuzz = () => (module ??= import('harfbuzzjs'));

/** A font's file, as uploaded in the dashboard. */
export interface FontSource {
  id: string;
  bytes: Uint8Array;
}

/** A shaped run of text: its outlines in font units, laid out left to right, y up. */
export interface ShapedRun {
  regions: Region[];
  /** The ink's bounds; null for text that draws nothing. */
  bounds: Bounds | null;
  /** The height letters are measured by (font units): Latin cap height, or Arabic ink height. */
  referenceHeight: number;
}

interface LoadedFont {
  face: HarfBuzz.Face;
  font: HarfBuzz.Font;
  capHeight: number;
  glyphs: Map<number, Region[]>;
}

/**
 * Fonts loaded into HarfBuzz, to shape text with: Arabic letters join in their right forms
 * and run right to left, Latin ones get kerning and ligatures, exactly as the font intends.
 */
export class FontSet {
  private constructor(
    private readonly hb: typeof HarfBuzz,
    private readonly fonts: Map<string, LoadedFont>,
  ) {}

  static async load(sources: readonly FontSource[]): Promise<FontSet> {
    const set = new FontSet(await harfbuzz(), new Map());
    set.add(sources);
    return set;
  }

  /** More fonts into the set (a font already in it is kept as it is). */
  add(sources: readonly FontSource[]): void {
    const { hb, fonts } = this;
    for (const { id, bytes } of sources) {
      if (fonts.has(id)) continue;
      const face = new hb.Face(new hb.Blob(bytes));
      if (!face.upem) throw new Error(`Font ${id} can't be read`);
      const font = new hb.Font(face);
      const capHeight = font.getMetricPositionWithFallback(
        hb.MetricsTag.CAP_HEIGHT,
      );
      fonts.set(id, {
        face,
        font,
        capHeight: capHeight > 0 ? capHeight : face.upem * 0.7,
        glyphs: new Map(),
      });
    }
  }

  /** The font's family name, as it calls itself (its name table, id 1). */
  familyName(fontId: string): string {
    return this.get(fontId).face.getName(1, 'en').trim();
  }

  has(fontId: string): boolean {
    return this.fonts.has(fontId);
  }

  /** The characters of `text` the font has no letter for (each once). */
  missing(fontId: string, text: string): string[] {
    const { font } = this.get(fontId);
    const out = new Set<string>();
    for (const c of text) {
      if (c.trim() === '') continue;
      if (font.glyph(c.codePointAt(0)!) === undefined) out.add(c);
    }
    return [...out];
  }

  /** The text shaped in one font: Arabic joined and right to left, as it should read. */
  shape(fontId: string, text: string): ShapedRun {
    const loaded = this.get(fontId);
    const buffer = new this.hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    this.hb.shape(loaded.font, buffer);
    const regions: Region[] = [];
    let x = 0;
    // After shaping, glyphs come in visual order (left to right on the page).
    for (const g of buffer.getGlyphInfosAndPositions()) {
      const dx = x + (g.xOffset ?? 0);
      const dy = g.yOffset ?? 0;
      regions.push(
        ...mapRegions(this.glyph(loaded, g.codepoint), ([px, py]) => [
          px + dx,
          py + dy,
        ]),
      );
      x += g.xAdvance ?? 0;
    }
    const bounds = boundsOf(regions);
    return {
      regions,
      bounds,
      referenceHeight:
        isArabic(text) && bounds ? bounds.maxY - bounds.minY : loaded.capHeight,
    };
  }

  private glyph(loaded: LoadedFont, glyphId: number): Region[] {
    let regions = loaded.glyphs.get(glyphId);
    if (!regions) {
      regions = regionsOf(contoursFromPath(loaded.font.glyphToJson(glyphId)));
      loaded.glyphs.set(glyphId, regions);
    }
    return regions;
  }

  private get(fontId: string): LoadedFont {
    const f = this.fonts.get(fontId);
    if (!f) throw new Error(`Font ${fontId} isn't loaded`);
    return f;
  }
}

/** Which scripts a font can write, checked when it is uploaded. */
export async function fontScripts(
  bytes: Uint8Array,
): Promise<{ name: string; latin: boolean; arabic: boolean }> {
  const fonts = await FontSet.load([{ id: 'f', bytes }]);
  return {
    name: fonts.familyName('f'),
    latin: fonts.missing('f', 'AZaz09').length === 0,
    arabic: fonts.missing('f', 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي').length === 0,
  };
}
