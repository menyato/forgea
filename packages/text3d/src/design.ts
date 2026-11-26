import type { Region } from './outline.js';

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
  'STANDING_INITIAL',
  'TROPHY',
  'STANDING_LOGO',
] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const TEXT_STYLE_LABELS: Readonly<Record<TextStyle, string>> = {
  KEYCHAIN: 'Name keychain',
  NAME: 'Standalone name',
  MONOGRAM: 'Curved initials',
  LETTERS: 'Single letters',
  INITIAL_NAME: 'Big initial with the name',
  COUPLE: 'Two names and a heart',
  STANDING_INITIAL: 'Standing initial, designed freely',
  TROPHY: 'Trophy, designed freely',
  STANDING_LOGO: 'Your logo standing, designed freely',
};

/**
 * Pieces customers design freely, like a board: a base (the big initial standing on its own,
 * or a trophy's plaque) with items on its face (text lines, decorations, logos) that they drag
 * where they like, size, turn and colour.
 */
export const BOARD_STYLES: readonly TextStyle[] = [
  'STANDING_INITIAL',
  'TROPHY',
  'STANDING_LOGO',
];

/** Decorations an item can be (drawn shapes, no font). */
export const BOARD_MOTIFS = [
  'HEART',
  'STAR',
  'FLOWER',
  'MOON',
  'CROWN',
  'BUTTERFLY',
] as const;
export type BoardMotif = (typeof BOARD_MOTIFS)[number];

export const BOARD_MOTIF_LABELS: Readonly<Record<BoardMotif, string>> = {
  HEART: 'Heart',
  STAR: 'Star',
  FLOWER: 'Flower',
  MOON: 'Moon',
  CROWN: 'Crown',
  BUTTERFLY: 'Butterfly',
};

export const BOARD_ITEM_KINDS = ['TEXT', 'MOTIF', 'LOGO'] as const;
export type BoardItemKind = (typeof BOARD_ITEM_KINDS)[number];

/**
 * One item on a board piece's face: where its centre is (mm from the base's centre, y up),
 * how tall it is, how it is turned and its colour. Later items lie over earlier ones.
 */
export interface BoardItem {
  /** Stable while the customer edits (their editor keys items by it). */
  id: string;
  kind: BoardItemKind;
  /** TEXT: what it says, and its font (none: the design's). */
  text?: string;
  fontId?: string;
  /** MOTIF: which decoration. */
  motif?: BoardMotif;
  /** LOGO: one of the studio's logos the product offers, or the customer's own. */
  logoId?: string;
  x: number;
  y: number;
  /** Its height, mm (text: its capitals). */
  size: number;
  /** Turned counter-clockwise, degrees. */
  rotation: number;
  /** The colour it prints in: one of the product's colours. */
  colour: string;
}

export const BOARD_LIMITS = {
  maxItems: 16,
  minSizeMm: 4,
  maxSizeMm: 150,
  maxTextChars: 40,
} as const;

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
export const TEXT_DECORS = [
  'HEARTS',
  'FLOWERS',
  'STARS',
  'CROWN',
  'BUTTERFLIES',
] as const;
export type TextDecor = (typeof TEXT_DECORS)[number];

export const TEXT_DECOR_LABELS: Readonly<Record<TextDecor, string>> = {
  HEARTS: 'Hearts',
  FLOWERS: 'Flowers and a heart',
  STARS: 'A moon and stars',
  CROWN: 'A crown and stars',
  BUTTERFLIES: 'Butterflies',
};

/**
 * A name keychain's plate: following the letters (OUTLINE, the default), or a shape the
 * customer picks among the ones the product offers.
 */
export const KEYCHAIN_SHAPES = ['OUTLINE', 'ROUNDED', 'OVAL', 'HEART'] as const;
export type KeychainShape = (typeof KEYCHAIN_SHAPES)[number];

export const KEYCHAIN_SHAPE_LABELS: Readonly<Record<KeychainShape, string>> = {
  OUTLINE: 'Follows the letters',
  ROUNDED: 'Rounded tag',
  OVAL: 'Oval',
  HEART: 'Heart',
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

/** Styles with an extra line under the names (a baby's weight and birth date, a wedding date). */
export const SUBTITLE_STYLES: readonly TextStyle[] = ['INITIAL_NAME', 'COUPLE'];

/** The most characters the extra line may have. */
export const SUBTITLE_MAX_CHARS = 28;

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
  /** INITIAL_NAME: the decorations chosen (none: the product's own). */
  decor?: TextDecor;
  /** INITIAL_NAME: the decorations' own colour; none = the initial's. */
  decorColour?: string;
  /**
   * INITIAL_NAME and COUPLE: a smaller line under the name, in the letters' colour and font
   * ("3.2 kg · 12/05/2026", "Since 2020"); none or empty = no line.
   */
  subtitle?: string;
  /** MONOGRAM and LETTERS: per letter (in typing order), its own font and colour. */
  letters?: { fontId?: string; colour?: string }[];
  /** KEYCHAIN: the plate's shape (OUTLINE when not chosen). */
  shape?: KeychainShape;
  /** KEYCHAIN: a logo beside the name (one of the studio's, offered by the product). */
  logoId?: string;
  /**
   * KEYCHAIN: a logo in its own colours, one filament per colour of the logo (its `inks`, in
   * order). Left out: the whole logo prints in the letters' colour.
   */
  logoColours?: string[];
  /** STANDING_INITIAL and TROPHY: the items on its face, as the customer placed them. */
  items?: BoardItem[];
}

/** One colour of a logo: where it is (in the logo's own frame) and the colour it was drawn in. */
export interface LogoInk {
  /** The colour in the drawing or picture (#rrggbb): the filament closest to it is suggested. */
  hex: string;
  regions: Region[];
}

/**
 * A logo as print outlines (1 across, centred on 0, 0): its whole outline, and, for a logo in
 * more than one colour, each colour's areas (the first is the largest: it fills the outline,
 * the others are printed over it in their own filament).
 */
export interface LogoShape {
  outline: Region[];
  inks?: LogoInk[] | null;
}

/** Most colours a logo is printed in (each one a filament). */
export const MAX_LOGO_INKS = 4;

/** Below this chroma (CIE Lab) a colour reads as black, grey, silver or white. */
const NEUTRAL_CHROMA = 12;

/**
 * The colour among `colours` closest to `hex` as a person would pick a filament for it, or
 * null when none has a swatch: a coloured part of a logo takes a coloured filament (a light
 * blue is printed blue, not silver), a black, grey or white part a neutral one, when the shop
 * has one of that kind; among those, the nearest in CIE Lab, lightness counting half (a
 * logo's colour is told by its hue more than its shade).
 */
export function nearestColour<T extends { swatchHex: string | null }>(
  hex: string,
  colours: readonly T[],
): T | null {
  const target = lab(hex);
  const chroma = ([, a, b]: readonly number[]) => Math.hypot(a!, b!);
  const neutral = chroma(target) < NEUTRAL_CHROMA;
  const known = colours.flatMap((c) =>
    c.swatchHex && /^#[0-9a-f]{6}$/i.test(c.swatchHex)
      ? [{ c, at: lab(c.swatchHex) }]
      : [],
  );
  const sameKind = known.filter(
    (k) => chroma(k.at) < NEUTRAL_CHROMA === neutral,
  );
  let best: T | null = null;
  let bestD = Infinity;
  for (const { c, at } of sameKind.length ? sameKind : known) {
    const d =
      ((at[0] - target[0]) / 2) ** 2 +
      (at[1] - target[1]) ** 2 +
      (at[2] - target[2]) ** 2;
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/**
 * Whether two colours found in a picture are one colour of the logo as it prints: two greys
 * (chrome, shading, a gradient) unless one is far lighter (black against silver), otherwise
 * colours a person would call the same (CIE Lab, lightness counting half).
 */
export function sameInk(a: string, b: string): boolean {
  const [la, lb] = [lab(a), lab(b)];
  const chroma = ([, x, y]: readonly number[]) => Math.hypot(x!, y!);
  if (chroma(la) < NEUTRAL_CHROMA && chroma(lb) < NEUTRAL_CHROMA)
    return Math.abs(la[0] - lb[0]) < 40;
  return Math.hypot((la[0] - lb[0]) / 2, la[1] - lb[1], la[2] - lb[2]) < 22;
}

/** #rrggbb (sRGB) as CIE L*a*b* (D65). */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
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
  /** A keychain carrying a logo may have no text: the logo alone. */
  logoAlone = false,
): string | null {
  const t = text.trim();
  if (t === '') return logoAlone ? null : 'Type the text';
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

/** Letters, digits, spaces and what dates, weights and times are written with. */
const SUBTITLE_ALLOWED = /^[\p{L}\p{M}\p{N} .,:/'·&+-]+$/u;

/** Why the extra line under a name can't be made, or null (an empty line is no line). */
export function subtitleProblem(text: string | undefined): string | null {
  const t = (text ?? '').trim();
  if (t === '') return null;
  if ([...t].length > SUBTITLE_MAX_CHARS)
    return `The line under the name: up to ${SUBTITLE_MAX_CHARS} characters`;
  if (!SUBTITLE_ALLOWED.test(t))
    return 'The line under the name: use letters, numbers, spaces and . , : / - only';
  if (ARABIC.test(t) && LATIN.test(t))
    return 'The line under the name: Arabic or English letters, not both';
  return null;
}

/**
 * Why a board piece's items can't be made, or null: how many, each one's size, where it is
 * (on or near the base: `reachMm` from its centre), and each text line's characters.
 */
export function boardItemsProblem(
  items: readonly BoardItem[],
  reachMm: number,
): string | null {
  if (items.length > BOARD_LIMITS.maxItems)
    return `At most ${BOARD_LIMITS.maxItems} things on one piece`;
  for (const item of items) {
    if (
      !Number.isFinite(item.size) ||
      item.size < BOARD_LIMITS.minSizeMm ||
      item.size > BOARD_LIMITS.maxSizeMm
    )
      return `Sizes from ${BOARD_LIMITS.minSizeMm} to ${BOARD_LIMITS.maxSizeMm} mm`;
    if (
      ![item.x, item.y, item.rotation].every(Number.isFinite) ||
      Math.hypot(item.x, item.y) > reachMm
    )
      return 'Keep everything on the piece';
    if (item.kind === 'TEXT') {
      const t = (item.text ?? '').trim();
      if (t === '') return 'Type the text, or remove the empty line';
      if ([...t].length > BOARD_LIMITS.maxTextChars)
        return `Up to ${BOARD_LIMITS.maxTextChars} characters in a line`;
      if (!SUBTITLE_ALLOWED.test(t))
        return 'Use letters, numbers, spaces and . , : / - only';
      if (ARABIC.test(t) && LATIN.test(t))
        return 'Arabic or English letters in a line, not both';
    } else if (item.kind === 'MOTIF') {
      if (!item.motif || !BOARD_MOTIFS.includes(item.motif))
        return 'Choose a decoration';
    } else if (!item.logoId) return 'Choose a logo';
  }
  return null;
}

/** How far from a board piece's centre its items may sit (mm): around the base, not far off. */
export function boardReachMm(settings: TextSettings): number {
  return Math.max(settings.letterHeightMm, settings.maxWidthMm) * 0.75;
}

/** The colours a design uses (each a separate filament: a multi-colour print). */
export function coloursOf(design: TextDesign, style: TextStyle): string[] {
  const colours = new Set([design.textColour]);
  if (PER_LETTER_STYLES.includes(style)) {
    for (const l of design.letters ?? []) if (l.colour) colours.add(l.colour);
  }
  if (design.accentColour && ACCENT_STYLES.includes(style))
    colours.add(design.accentColour);
  if (design.decorColour && style === 'INITIAL_NAME')
    colours.add(design.decorColour);
  if (design.baseColour && style !== 'LETTERS') colours.add(design.baseColour);
  if (style === 'KEYCHAIN' && design.logoId)
    for (const c of design.logoColours ?? []) colours.add(c);
  if (BOARD_STYLES.includes(style))
    for (const item of design.items ?? []) colours.add(item.colour);
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
  if (BOARD_STYLES.includes(style))
    for (const item of design.items ?? [])
      if (item.kind === 'TEXT' && item.fontId) fonts.add(item.fontId);
  return [...fonts];
}

/**
 * A place on a product's model where text or a logo is added (any product, not only a text
 * studio one). The owner sets it on the product's page; customers may change what it says,
 * its font, whether the logo shows, and its colour, when it is `editable`.
 */
export const SLOT_KINDS = ['TEXT', 'LOGO'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** Where a slot sits, in the model file's own millimetres (Z up, as slicers read it). */
/** A slot's recorded face keeps at most this many points (it travels with the product). */
export const MAX_FACE_POINTS = 1500;

export interface SlotPlacement {
  /** The centre of the text or logo, on the model's surface. */
  origin: [number, number, number];
  /** Out of the surface: the text stands up along it. */
  normal: [number, number, number];
  /** Which way is up for the text, roughly (made square to `normal`). */
  up: [number, number, number];
  /**
   * The flat area under it (`faceAround`: model file frame, mm, each contour x, y, z, …):
   * text and logos are made smaller until they sit inside it, so nothing hangs off the edge.
   * Recorded when the owner clicks the place on the model; older slots have none.
   */
  face?: number[][];
  /**
   * What stands in front of that face (`inFrontAround`: other parts of the model, as a lawyer
   * trophy's scales before its board), outlines in the same frame: text and logos keep the
   * slot's `gapMm` from them. Recorded with the face; older slots have none.
   */
  blocked?: number[][];
}

export interface DesignSlot {
  /** Stable while the product is edited: carts and orders keep choices by it. */
  id: string;
  kind: SlotKind;
  /** What customers read above it ("Name", "Logo"). */
  label: string;
  /** Customers may change it; otherwise it is always the owner's. */
  editable: boolean;
  placement: SlotPlacement;
  /** Text: the letters' height (cap height). Logo: its height. In mm. */
  heightMm: number;
  /** Longer text (or a wider logo) is scaled down to fit, mm. */
  maxWidthMm: number;
  /** How far it stands out of the surface (RAISED) or goes into it (FLUSH), mm. */
  depthMm: number;
  /**
   * RAISED (the default): it stands `depthMm` out of the surface. FLUSH: it goes `depthMm` into
   * the surface, its top level with it: an inlay in its own colour (the slicer prints the
   * overlap in the slot's filament).
   */
  relief?: SlotRelief;
  /**
   * On a recorded face: how far inside its edge the text or logo keeps, mm (inside a border
   * line, say). Not set: `SLOT_LIMITS.defaultEdgeMm`.
   */
  edgeMm?: number;
  /**
   * On a recorded face: centred across the free part of its row (the face less what stands in
   * front of it and the slots before it), wherever it was clicked along the row.
   */
  centred?: boolean;
  /**
   * On a recorded face: the gap it keeps from the slots listed before it on the same face, and
   * from what stands in front of it (`placement.blocked`), mm. Not set: no gap from other
   * slots (as before), and none beyond touching from what stands in front.
   */
  gapMm?: number;
  /** The colour it prints in: an option value id of the product's colour choices. */
  colour: string;
  /** Text: what it says until a customer changes it (may be empty: nothing shown). */
  defaultText?: string;
  maxChars?: number;
  defaultFontId?: string;
  /** Logo: which of the studio's logos, and whether it shows until a customer turns it off. */
  logoId?: string;
  defaultOn?: boolean;
  /**
   * Logo: the studio's logos customers may pick from for this place (as a sign on a plate:
   * the cedar, a profession). `logoId` is the one it starts with.
   */
  logoChoices?: string[];
}

export const SLOT_RELIEFS = ['RAISED', 'FLUSH'] as const;
export type SlotRelief = (typeof SLOT_RELIEFS)[number];

/** What a customer chose for one slot; anything left out is the owner's default. */
export interface SlotChoice {
  text?: string;
  fontId?: string;
  on?: boolean;
  colour?: string;
  /** An editable logo slot: the customer's own logo (uploaded) instead of the studio's. */
  logoId?: string;
  /** A logo in its own colours: a colour for each of its colours (`LogoShape.inks`). */
  logoColours?: string[];
}

export const SLOT_LIMITS = {
  maxSlots: 8,
  minHeightMm: 3,
  maxHeightMm: 200,
  minDepthMm: 0.4,
  maxDepthMm: 10,
  maxWidthMm: 400,
  maxChars: 40,
  defaultEdgeMm: 0.6,
  maxEdgeMm: 30,
  /** What the dashboard suggests for a new slot's gap, mm. */
  suggestedGapMm: 3,
} as const;

/** What a slot shows for a choice: its text, font, whether it shows, its colour, its logo. */
export function slotState(slot: DesignSlot, choice: SlotChoice | undefined) {
  const own = slot.editable ? (choice ?? {}) : {};
  const logoId = slot.kind === 'LOGO' ? (own.logoId ?? slot.logoId) : undefined;
  return {
    logoId,
    text: (own.text ?? slot.defaultText ?? '').trim(),
    fontId: own.fontId ?? slot.defaultFontId ?? '',
    on:
      slot.kind === 'LOGO'
        ? logoId !== undefined &&
          (own.on ?? (own.logoId ? true : (slot.defaultOn ?? true)))
        : (own.text ?? slot.defaultText ?? '').trim() !== '',
    colour: own.colour ?? slot.colour,
    logoColours: slot.kind === 'LOGO' ? own.logoColours : undefined,
  };
}

/** Why a customer's text for a slot can't be made, or null. Fonts are checked when known. */
export function slotTextProblem(slot: DesignSlot, text: string): string | null {
  if (text.trim() === '') return null;
  return textProblem(text, {
    style: 'NAME',
    maxChars: slot.maxChars ?? SLOT_LIMITS.maxChars,
    letterHeightMm: slot.heightMm,
    letterDepthMm: slot.depthMm,
    baseDepthMm: 0,
    maxWidthMm: slot.maxWidthMm,
  });
}
export type { Region };
