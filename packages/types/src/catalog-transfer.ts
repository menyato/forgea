import type { OptionKind } from './generated/prisma/enums.js';

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
  products: CatalogProduct[];
}

export interface CatalogMaterial {
  code: string;
  name: string;
  pricePerGram: string;
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
    'materials' | 'categories' | 'optionGroups' | 'optionValues' | 'products',
    number
  >;
  updated: Record<
    'materials' | 'categories' | 'optionGroups' | 'optionValues' | 'products',
    number
  >;
  /** Already there and left alone (adding mode), or unchanged files reused. */
  skipped: number;
}
