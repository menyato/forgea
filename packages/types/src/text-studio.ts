import type { TextDecor, TextStyle } from './generated/prisma/enums.js';
import type {
  BoardItem,
  DesignSlot,
  KeychainShape,
  LogoInk,
  Region,
} from '@forgea/text3d/design';
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
  /** Name keychains: the plate shapes customers choose from (empty: follows the letters). */
  shapes: KeychainShape[];
  /** Name keychains: the studio's logos customers may add beside their name. */
  logoIds: string[];
  /** Name keychains: customers may bring their own logo (beside their name or alone). */
  ownLogo: boolean;
}

/** What the product page offers a customer to design with. */
export interface ProductTextOffer extends Omit<
  ProductTextSettings,
  'colourGroupId'
> {
  colours: { id: string; label: string; swatchHex: string | null }[];
  fonts: Pick<FontView, 'id' | 'name' | 'fileKey' | 'latin' | 'arabic'>[];
  /** The logos customers may add (keychains), as print outlines (and their colours). */
  logos: {
    id: string;
    name: string;
    outline: Region[];
    inks: LogoInk[] | null;
  }[];
}

/**
 * What the browser measured when it built the design for its 3D preview (the same
 * @forgea/text3d code the studio prints from): each colour's volume and the piece's size.
 * The live price and the cart use it, so typing costs the server no geometry; checkout
 * builds the design on the server once and prices what it measures there.
 */
export interface DesignMeasurement {
  parts: { colour: string; volumeMm3: number }[];
  size: { x: number; y: number; z: number };
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
  /** Big initial: the decorations chosen (none: the product's own). */
  decor?: TextDecor;
  /** Big initial: the decorations' own colour (none: the initial's). */
  decorColour?: string;
  /** Big initial and couple: a smaller line under the name (a weight, a birth date). */
  subtitle?: string;
  /** The letter height chosen (mm): the product's own, or one of its sizes. */
  heightMm?: string;
  /** Curved initials and single letters: per letter, its font and colour. */
  letters?: { fontId?: string; colour?: string }[];
  /** Name keychains: the plate's shape and a logo beside the name. */
  shape?: KeychainShape;
  logoId?: string;
  /** The logo in its own colours: a colour (option value id) for each of its `inks`. */
  logoColours?: string[]; /** Standing initials and trophies: the items on its face, as placed (colours are ids). */
  items?: BoardItem[];
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
  /** Big initial: the decorations by name, and their colour when it differs from the initial's. */
  decor?: string | null;
  decorColour?: string | null;
  /** The line under the name (orders made before it existed have none). */
  subtitle?: string | null;
  /** Curved initials and single letters: each letter's font and colour. */
  letters: { char: string; font: string; colour: string }[] | null;
  /** The letters' height, mm (the size chosen). */
  letterHeightMm: number;
  /** Name keychains: the plate's shape and the logo on it, by name; null = none chosen. */
  shape: string | null;
  logo: string | null;
  /** The logo in its own colours: each of its colours' filament, by name (null: one colour). */
  logoColours: string[] | null;
  /** Standing initials and trophies: what is on its face, in order, by name. */
  items?: { kind: BoardItem['kind']; label: string; colour: string }[] | null;
  /** The piece's size, mm (width × depth × height as it lies on the bed). */
  sizeMm: { x: number; y: number; z: number };
}

/** A logo the studio adds to products (Dashboard → Logos). */
export interface LogoView {
  id: string;
  name: string;
  /** How detailed its outline is. */
  points: number;
  active: boolean;
  sortOrder: number;
}

/**
 * A customer's own logo, read into a print outline (POST /logos/yours): its id goes in their
 * design or slot choice, the outline shows it in 3D.
 */
export interface CustomerLogoView {
  id: string;
  outline: Region[];
  /** Its colours' areas, when it has more than one colour (the customer picks a filament for each). */
  inks: LogoInk[] | null;
  points: number;
}

/** A logo with its print outline (1 across, centred): GET /logos/:id. */
export interface LogoDetail extends LogoView {
  outline: Region[];
  inks: LogoInk[] | null;
}

/** What a product page needs to show and change its text and logo slots. */
export interface ProductSlotsOffer {
  /** Every slot (the ones customers can't change show as the owner set them). */
  slots: DesignSlot[];
  /** The logos its slots use, as print outlines (1 across, centred). */
  logos: {
    id: string;
    outline: Region[];
    inks: LogoInk[] | null;
    /** The studio's name for it (shown where customers pick a logo). */
    name?: string;
  }[];
  /** The fonts its text slots may be written in. */
  fonts: Pick<FontView, 'id' | 'name' | 'fileKey' | 'latin' | 'arabic'>[];
  /** The colours slots may print in (the product's part colours, or its text colours). */
  colours: { id: string; label: string; swatchHex: string | null }[];
}

/** One slot as chosen, for the cart, an order and the studio (names, not ids). */
export interface SlotSummary {
  slotId: string;
  label: string;
  kind: 'TEXT' | 'LOGO';
  /** Text: what it says. */
  text: string | null;
  font: string | null;
  /** Logo: which one. */
  logo: string | null;
  colour: string;
  grams: string;
}
