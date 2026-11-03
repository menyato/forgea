/**
 * A personalised piece, as the customer designs it and as the studio prints it. This module
 * has no 3D code, so validation and the API's main thread can import it cheaply
 * (`@forgea/text3d/design`).
 */

/**
 * - KEYCHAIN: raised letters on a plate, with a ring for the keys.
 * - NAME: a big standalone name, its letters joined by a bar so it prints in one piece.
 * - MONOGRAM: up to three initials overlapping along a curve, each in its own font and colour.
 * - LETTERS: single letters, each a separate piece in its own font and colour.
 * - INITIAL_NAME: the name's first letter big, the whole name across it and decorations
 *   around it (the product's decoration theme), standing.
 * - COUPLE: two names with a heart between them, standing.
 */
export const TEXT_STYLES = [
  'KEYCHAIN',
  'NAME',
  'MONOGRAM',
  'LETTERS',
  'INITIAL_NAME',
  'COUPLE',
] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const TEXT_STYLE_LABELS: Readonly<Record<TextStyle, string>> = {
  KEYCHAIN: 'Name keychain',
  NAME: 'Standalone name',
  MONOGRAM: 'Curved initials',
  LETTERS: 'Single letters',
  INITIAL_NAME: 'Big initial with the name',
  COUPLE: 'Two names and a heart',
};

/** Styles that stand on a foot (a name, initials) rather than lie flat. */
export const STANDING_STYLES: readonly TextStyle[] = [
  'NAME',
  'MONOGRAM',
  'INITIAL_NAME',
  'COUPLE',
];

/** Styles with an accent colour: the big initial and its decorations, or the heart. */
export const ACCENT_STYLES: readonly TextStyle[] = ['INITIAL_NAME', 'COUPLE'];

/** The decorations around a big initial, chosen per product (e.g. a baby's, a boy's). */
export const TEXT_DECORS = ['HEARTS', 'FLOWERS', 'STARS', 'CROWN'] as const;
export type TextDecor = (typeof TEXT_DECORS)[number];

export const TEXT_DECOR_LABELS: Readonly<Record<TextDecor, string>> = {
  HEARTS: 'Hearts',
  FLOWERS: 'Flowers and a heart',
  STARS: 'A moon and stars',
  CROWN: 'A crown and stars',
};

/** Styles where each letter has its own font and colour. */
export const PER_LETTER_STYLES: readonly TextStyle[] = ['MONOGRAM', 'LETTERS'];

/** How a product's pieces are made: the owner's settings (dashboard, product page). */
export interface TextSettings {
  style: TextStyle;
  /** Most characters a customer may type (letters for MONOGRAM: at most 3). */
  maxChars: number;
  /** Height of the letters (cap height), mm. */
  letterHeightMm: number;
  /** Thickness of the letters, mm (raised above the plate on a keychain). */
  letterDepthMm: number;
  /** Plate or bar thickness, mm (keychain plate, name bar, monogram band). */
  baseDepthMm: number;
  /** The widest a piece may be, mm: longer text is scaled down to fit. */
  maxWidthMm: number;
  /** INITIAL_NAME: the decorations around the initial (hearts when not set). */
  decor?: TextDecor;
}

/** What the customer chose. Colours are option value ids (the product's colour group). */
export interface TextDesign {
  text: string;
  /** The font for the whole text (KEYCHAIN, NAME), and the default per letter. */
  fontId: string;
  /** The letters' colour, and the default per letter. */
  textColour: string;
  /** The plate, bar or band colour; none = the letters' colour. */
  baseColour?: string;
  /** INITIAL_NAME: the big initial and decorations; COUPLE: the heart. None = the letters'. */
  accentColour?: string;
  /** INITIAL_NAME: the big initial's font; none = the name's. */
  accentFontId?: string;
  /** MONOGRAM and LETTERS: per letter (in typing order), its own font and colour. */
  letters?: { fontId?: string; colour?: string }[];
}

export const TEXT_LIMITS = {
  maxChars: 24,
  monogramLetters: 3,
  minHeightMm: 5,
  maxHeightMm: 200,
  minDepthMm: 0.6,
  maxDepthMm: 30,
  maxWidthMm: 400,
} as const;

/** COUPLE: the two names, typed as one text joined by "&". */
export const COUPLE_JOIN = ' & ';

export const coupleNames = (text: string): string[] =>
  text.split('&').map((n) => n.trim());

/** Letters (any script), digits, spaces and a little punctuation. */
const ALLOWED = /^[\p{L}\p{M}\p{N} &'.!-]+$/u;
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /\p{Script=Latin}/u;

export const isArabic = (text: string) => ARABIC.test(text);

/** The characters that make up the text, as the customer sees them (no spaces). */
export const lettersOf = (text: string): string[] =>
  [...text].filter((c) => c.trim() !== '');

/**
 * Why a text can't be made, in the customer's words, or null when it can (the font's glyphs
 * are checked separately, once the font is known).
 */
export function textProblem(
  text: string,
  settings: TextSettings,
): string | null {
  const t = text.trim();
  if (t === '') return 'Type the text';
  if (settings.style === 'COUPLE') {
    const names = coupleNames(t);
    if (names.length !== 2 || names.some((n) => n === ''))
      return 'Type both names';
    if (names.some((n) => [...n].length > settings.maxChars))
      return `At most ${settings.maxChars} characters in each name`;
  } else if ([...t].length > settings.maxChars)
    return `At most ${settings.maxChars} characters`;
  if (!ALLOWED.test(t))
    return "Use letters, numbers, spaces and & ' . ! - only";
  if (ARABIC.test(t) && LATIN.test(t))
    return 'Use Arabic or English letters, not both in one text';
  if (settings.style === 'MONOGRAM') {
    const letters = lettersOf(t);
    if (letters.length > TEXT_LIMITS.monogramLetters || t.includes(' '))
      return `Up to ${TEXT_LIMITS.monogramLetters} initials, no spaces`;
  }
  return null;
}

/** The colours a design uses (each a separate filament: a multi-colour print). */
export function coloursOf(design: TextDesign, style: TextStyle): string[] {
  const colours = new Set([design.textColour]);
  if (PER_LETTER_STYLES.includes(style)) {
    for (const l of design.letters ?? []) if (l.colour) colours.add(l.colour);
  }
  if (design.accentColour && ACCENT_STYLES.includes(style))
    colours.add(design.accentColour);
  if (design.baseColour && style !== 'LETTERS') colours.add(design.baseColour);
  return [...colours];
}

/** The fonts a design uses. */
export function fontsOf(design: TextDesign, style: TextStyle): string[] {
  const fonts = new Set([design.fontId]);
  if (PER_LETTER_STYLES.includes(style)) {
    for (const l of design.letters ?? []) if (l.fontId) fonts.add(l.fontId);
  }
  if (design.accentFontId && style === 'INITIAL_NAME')
    fonts.add(design.accentFontId);
  return [...fonts];
}
