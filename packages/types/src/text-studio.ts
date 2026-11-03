import type { TextDecor, TextStyle } from './generated/prisma/enums.js';
import type { Money } from './lists.js';

/** A font customers write in (Dashboard → Fonts). */
export interface FontView {
  id: string;
  name: string;
  /** The uploaded file (served at /media/<key>), loaded by the live preview. */
  fileKey: string;
  latin: boolean;
  arabic: boolean;
  active: boolean;
  sortOrder: number;
}

/** A personalised product's settings, as the owner edits them. */
export interface ProductTextSettings {
  style: TextStyle;
  maxChars: number;
  letterHeightMm: string;
  letterDepthMm: string;
  baseDepthMm: string;
  maxWidthMm: string;
  /** The option group whose colours customers choose from. */
  colourGroupId: string;
  /** Added for every colour beyond the first. */
  extraColourPrice: Money;
  /** More letter heights customers may choose (mm); letterHeightMm is the default one. */
  sizesMm: string[];
  /** The colours a design starts with (option value ids); null = the first offered. */
  defaultColourId: string | null;
  /** null: the backing starts the letters' colour. */
  defaultBaseColourId: string | null;
  /** Big initial and couple pieces: the accent's starting colour; null = the letters'. */
  defaultAccentColourId: string | null;
  /** Big initial pieces: the decorations around the initial (null for other styles). */
  decor: TextDecor | null;
}

/** What the product page offers a customer to design with. */
export interface ProductTextOffer extends Omit<
  ProductTextSettings,
  'colourGroupId'
> {
  colours: { id: string; label: string; swatchHex: string | null }[];
  fonts: Pick<FontView, 'id' | 'name' | 'fileKey' | 'latin' | 'arabic'>[];
}

/** The customer's design, as sent (colours are option value ids from `colours`). */
export interface TextDesignInput {
  text: string;
  fontId: string;
  textColour: string;
  baseColour?: string;
  /** Big initial: the initial and decorations' colour; couple: the heart's. */
  accentColour?: string;
  /** Big initial: the initial's font. */
  accentFontId?: string;
  /** The letter height chosen (mm): the product's own, or one of its sizes. */
  heightMm?: string;
  /** Curved initials and single letters: per letter, its font and colour. */
  letters?: { fontId?: string; colour?: string }[];
}

/** How a design reads in the cart, an order and the dashboard (names, not ids). */
export interface DesignSummary {
  style: TextStyle;
  text: string;
  font: string;
  textColour: string;
  /** The backing's colour, when it differs from the letters'. */
  baseColour: string | null;
  /** Big initial or couple: the accent's colour (initial and decorations, or the heart). */
  accentColour: string | null;
  /** Big initial: the initial's font, when it differs from the name's. */
  accentFont: string | null;
  /** Curved initials and single letters: each letter's font and colour. */
  letters: { char: string; font: string; colour: string }[] | null;
  /** The letters' height, mm (the size chosen). */
  letterHeightMm: number;
  /** The piece's size, mm (width × depth × height as it lies on the bed). */
  sizeMm: { x: number; y: number; z: number };
}
