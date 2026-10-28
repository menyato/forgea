import { colorSchemes } from './color-schemes.js';
import { type PaletteName, palettes } from './palettes.js';
import type { DesignTokens } from './types.js';

/**
 * Forgea design tokens — the one file to edit when the final palette and fonts are decided.
 *
 * Chosen 2026-10-26: "copper" with the original build-plate logo (option 0). To try another,
 * change the name below to 'canva', 'kiln', 'maroon' or 'resin'
 * (all defined in palettes.ts). The web app, the logo SVGs, emails and the 3D viewer all
 * follow; nothing else hardcodes colour.
 */
export const defaultPaletteName: PaletteName = 'copper';
const palette = palettes[defaultPaletteName];

export const tokens: DesignTokens = {
  color: colorSchemes(palette),
  font: {
    // PLACEHOLDERS until the owner picks fonts. League Spartan matches the current logo.
    // Self-hosted by the web app (@fontsource-variable packages), so no third-party requests.
    display: {
      family: 'League Spartan Variable',
      fallback: 'system-ui, sans-serif',
    },
    body: { family: 'Inter Variable', fallback: 'system-ui, sans-serif' },
  },
  fontWeight: { regular: 400, medium: 500, bold: 700, heavy: 800 },
  fontSize: {
    xs: 0.75,
    sm: 0.875,
    md: 1,
    lg: 1.125,
    xl: 1.5,
    '2xl': 2,
    '3xl': 2.75,
    display: 4.5,
  },
  space: {
    '0': 0,
    '1': 0.25,
    '2': 0.5,
    '3': 0.75,
    '4': 1,
    '5': 1.25,
    '6': 1.5,
    '8': 2,
    '10': 2.5,
    '12': 3,
    '16': 4,
  },
  radius: { none: 0, sm: 4, md: 8, lg: 16, pill: 999 },
  motion: { fast: 120, base: 200, slow: 360 },
};
