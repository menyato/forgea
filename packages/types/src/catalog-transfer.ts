import type {
  OptionKind,
  ProfitKind,
  TextDecor,
  TextStyle,
} from './generated/prisma/enums.js';

/**
 * A whole catalog in one JSON file, to move it between installations (local → deployed) or
 * to load the examples. Everything is matched by its natural key — material code, category
 * slug, option group name, value label, product slug — never by database id, so the same file
 * imports anywhere and importing it twice changes nothing.
 */
export interface CatalogFile {
  format: 'forgea-catalog';
  version: 1;
  exportedAt?: string;
  materials: CatalogMaterial[];
  categories: CatalogCategory[];
  optionGroups: CatalogOptionGroup[];
  /** Fonts for personalised text (optional in older files). */
  fonts?: CatalogFont[];
  products: CatalogProduct[];
}

/** A font customers write in, its file inside the catalog. Matched by name. */
export interface CatalogFont {
  name: string;
  active: boolean;
  sortOrder: number;
  file: CatalogAsset;
}

export interface CatalogMaterial {
  code: string;
  name: string;
  pricePerGram: string;
  /** One reel as bought (optional in older files): the price per gram comes from it. */
  reel?: { price: string; grams: number } | null;
  densityGPerCm3: string;
  gramsPerHour: string;
  active: boolean;
}

export interface CatalogCategory {
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface CatalogOptionGroup {
  name: string;
  kind: OptionKind;
  maxLength: number | null;
  textExtraPrice: string;
  sortOrder: number;
  active: boolean;
  values: {
    label: string;
    swatchHex: string | null;
    gramsMultiplier: string;
    hoursMultiplier: string;
    extraPrice: string;
    /** Material code the value switches to (e.g. "PETG"), if any. */
    material: string | null;
    sortOrder: number;
    active: boolean;
  }[];
}

/** A file carried inside the catalog: its bytes, base64-encoded. */
export interface CatalogAsset {
  name: string;
  base64: string;
}

export interface CatalogProduct {
  slug: string;
  name: string;
  description: string;
  /** Category slug. */
  category: string | null;
  /** Material code. */
  material: string;
  grams: string;
  printHours: string;
  isCustom: boolean;
  designer: string | null;
  active: boolean;
  /** Never sold (absent in older files: false). */
  studioOnly?: boolean;
  model: CatalogAsset | null;
  images: CatalogAsset[];
  options: {
    /** Option group name. */
    group: string;
    required: boolean;
    /** Value labels offered. */
    values: string[];
    default: string | null;
  }[];
  /** Personalised text: how its pieces are made (optional; none = a regular product). */
  text?: {
    style: TextStyle;
    maxChars: number;
    letterHeightMm: string;
    letterDepthMm: string;
    baseDepthMm: string;
    maxWidthMm: string;
    /** The option group customers choose colours from, by name. */
    colourGroup: string;
    extraColourPrice: string;
    /** More letter heights customers may choose (optional). */
    sizesMm?: string[];
    /** The colours a design starts with, by label (optional). */
    defaultColour?: string | null;
    defaultBaseColour?: string | null;
    defaultAccentColour?: string | null;
    /** Big initial pieces: their decorations. */
    decor?: TextDecor | null;
  } | null;
  /** Its own profit rule (optional; none = the importing shop's own). */
  profit?: { kind: ProfitKind; value: string } | null;
  /** The owner's own price in place of the calculated one (optional; none = calculated). */
  priceOverride?: string | null;
  /**
   * Multi-colour: grams per colour at its own size (optional; none = one colour). A `part`
   * customers recolour from `partColourGroup`, starting in its `colour`.
   */
  colours?: {
    colour: string;
    hex: string;
    grams: string;
    part?: string | null;
    /** The part colours' choice it starts in (a label); none = automatic. */
    startsAs?: string | null;
  }[];
  /** The option group customers recolour named parts from (by name). */
  partColourGroup?: string | null;
  /** The printed size grams and printHours are for (optional in older files). */
  size?: { x: string; y: string; z: string } | null;
  /** The real sizes it is sold in (optional in older files). */
  sizes?: {
    label: string;
    size: { x: string; y: string; z: string };
    grams: string;
    printHours: string;
    default: boolean;
  }[];
}

/** What an import did, per kind of entry. */
export interface CatalogImportReport {
  created: Record<
    | 'materials'
    | 'categories'
    | 'optionGroups'
    | 'optionValues'
    | 'fonts'
    | 'products',
    number
  >;
  updated: Record<
    | 'materials'
    | 'categories'
    | 'optionGroups'
    | 'optionValues'
    | 'fonts'
    | 'products',
    number
  >;
  /** Already there and left alone (adding mode), or unchanged files reused. */
  skipped: number;
}
