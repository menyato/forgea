import type { ProductTextOffer } from '@forgea/types';
import { useEffect } from 'react';

/** The CSS family a shop font is registered under (its own name may clash with a system one). */
export const fontFamilyOf = (fontId: string) => `forgea-font-${fontId}`;

const added = new Set<string>();

/**
 * Registers the shop's fonts with the browser (FontFace), so the font picker shows each name
 * written in its own font. Each file is fetched once; the server renders with a fallback.
 */
export function useFontFaces(
  fonts: readonly Pick<ProductTextOffer['fonts'][number], 'id' | 'fileKey'>[],
): void {
  useEffect(() => {
    for (const f of fonts) {
      if (added.has(f.id)) continue;
      added.add(f.id);
      const face = new FontFace(fontFamilyOf(f.id), `url(/media/${f.fileKey})`);
      face
        .load()
        .then((loaded) => document.fonts.add(loaded))
        // A font that won't load just shows in the page's own font.
        .catch(() => added.delete(f.id));
    }
  }, [fonts]);
}
