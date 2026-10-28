import { colorSchemes } from './color-schemes.js';
import { contrastRatio } from './contrast.js';
import type { Palette } from './types.js';

/** WCAG AA: 4.5:1 for body text, 3:1 for large text and UI components. */
const AA_TEXT = 4.5;
const AA_UI = 3;

export interface ContrastCheck {
  mode: 'light' | 'dark';
  /** What is being read, in the owner's words, e.g. "Text on buttons". */
  label: string;
  /** The colour being read; the one `fixContrast` changes. */
  key: keyof Palette;
  /** What it is read on. */
  background: string;
  ratio: number;
  required: number;
  passes: boolean;
}

/** Every colour a palette must have, in the order the theme editor shows them. */
export const PALETTE_KEYS = [
  'paper',
  'white',
  'ink',
  'graphite',
  'ash',
  'accent',
  'accentDeep',
  'onAccent',
  'night',
  'nightRaised',
  'nightBorder',
  'mist',
  'stone',
  'accentDark',
  'onAccentDark',
  'green',
  'amber',
  'red',
] as const satisfies readonly (keyof Palette)[];

const HEX = /^#[0-9a-f]{6}$/i;

/** True when `value` has exactly the palette's colours, each as #rrggbb. */
export function isPalette(value: unknown): value is Palette {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === PALETTE_KEYS.length &&
    PALETTE_KEYS.every(
      (k) => typeof record[k] === 'string' && HEX.test(record[k]),
    )
  );
}

/**
 * The readability checks every palette must pass, in light and dark mode: the built-in
 * palettes are tested with these, and a custom palette that fails one is saved only when the owner confirms it.
 */
export function paletteChecks(palette: Palette): ContrastCheck[] {
  const schemes = colorSchemes(palette);
  return (['light', 'dark'] as const).flatMap((mode) => {
    const s = schemes[mode];
    const light = mode === 'light';
    const check = (
      label: string,
      key: keyof Palette,
      background: string,
      required: number,
    ): ContrastCheck => {
      const ratio = contrastRatio(palette[key], background);
      return {
        mode,
        label,
        key,
        background,
        ratio,
        required,
        passes: ratio >= required,
      };
    };
    return [
      check('Text on the page', light ? 'ink' : 'mist', s.background, AA_TEXT),
      check('Text on cards', light ? 'ink' : 'mist', s.surface, AA_TEXT),
      check(
        'Secondary text',
        light ? 'graphite' : 'stone',
        s.background,
        AA_TEXT,
      ),
      check(
        'Text on buttons',
        light ? 'onAccent' : 'onAccentDark',
        s.accent,
        AA_TEXT,
      ),
      check(
        'Keyboard focus ring',
        light ? 'accentDeep' : 'accentDark',
        s.background,
        AA_UI,
      ),
      check('Logo', light ? 'ink' : 'mist', s.background, AA_TEXT),
    ];
  });
}

/** `hex` moved `amount` (0–1) of the way towards `target`. */
function mix(hex: string, target: string, amount: number): string {
  const channels = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const to = channels(target);
  const mixed = channels(hex).map((c, i) =>
    Math.round(c + (to[i]! - c) * amount)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${mixed.join('')}`;
}

/**
 * The palette with every colour that fails a check darkened or lightened just enough to pass
 * (towards black or white, whichever reads better on its background); the others untouched.
 * Always succeeds: black or white reaches at least 4.58:1 on any background.
 */
export function fixContrast(palette: Palette): Palette {
  let fixed = { ...palette };
  // A colour can be read on two backgrounds (text on the page and on cards): repeat.
  for (let round = 0; round < 4; round++) {
    const failing = paletteChecks(fixed).filter((c) => !c.passes);
    if (failing.length === 0) break;
    for (const c of failing) {
      const original = fixed[c.key];
      const target =
        contrastRatio('#000000', c.background) >=
        contrastRatio('#ffffff', c.background)
          ? '#000000'
          : '#ffffff';
      for (let step = 1; step <= 50; step++) {
        const candidate = mix(original, target, step / 50);
        fixed = { ...fixed, [c.key]: candidate };
        if (contrastRatio(candidate, c.background) >= c.required) break;
      }
    }
  }
  return fixed;
}
