import type { OptionKind } from './generated/prisma/enums.js';
import type { Money, ProductListItem } from './lists.js';

// Everything the dashboard configures about the catalog, and what the shop shows of it.
// Decimal values travel as strings ("1.800"), exactly as the database stores them.

export interface CategoryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface MaterialView {
  id: string;
  code: string;
  name: string;
  pricePerGram: string;
  densityGPerCm3: string;
  gramsPerHour: string;
  stockGrams: number;
  lowStockThresholdGrams: number;
  active: boolean;
}

export interface OptionValueView {
  id: string;
  label: string;
  swatchHex: string | null;
  gramsMultiplier: string;
  hoursMultiplier: string;
  extraPrice: Money;
  /** Choosing this value prints in this material. */
  materialId: string | null;
  sortOrder: number;
  active: boolean;
}

export interface OptionGroupView {
  id: string;
  name: string;
  kind: OptionKind;
  maxLength: number | null;
  textExtraPrice: Money;
  sortOrder: number;
  active: boolean;
  values: OptionValueView[];
}

/**
 * The choice of a product's own sizes travels like an option, under this group id, so the
 * cart, checkout and order keep one shape for every choice.
 */
export const PRODUCT_SIZE_GROUP_ID = '00000000-0000-4000-8000-000000000051';

/** A printed size in cm: width × depth × height. */
export interface SizeCm {
  x: string;
  y: string;
  z: string;
}

/** One option a product offers, as the shop shows it (no price rules: those stay server-side). */
export interface ProductOption {
  groupId: string;
  name: string;
  /** 'SIZE': the product's own sizes, each choice its measurements ("13 × 13 × 26 cm"). */
  kind: OptionKind | 'SIZE';
  required: boolean;
  maxLength: number | null;
  choices: {
    id: string;
    label: string;
    swatchHex: string | null;
  }[];
  defaultValueId: string | null;
}

/** A customer's choice for one option, as sent with "add to cart" and the price check. */
export interface OptionSelection {
  groupId: string;
  valueId?: string;
  text?: string;
}

/** A choice by name, for display and for the order's snapshot. */
export interface ChosenOption {
  group: string;
  value: string;
}

/** GET /products/:slug */
export interface ProductDetail extends ProductListItem {
  isCustom: boolean;
  /** "Designed by …", when the product credits a designer. */
  designer: string | null;
  imageKeys: string[];
  options: ProductOption[];
  /** Its printed size when it comes in one size only (with sizes, each choice says its own). */
  size: SizeCm | null;
}

/** How a product offers one option group (dashboard). */
export interface ProductOptionConfig {
  groupId: string;
  required: boolean;
  valueIds: string[];
  defaultValueId: string | null;
}

/** GET /products/manage/:id — everything the dashboard edits. */
export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  categoryId: string | null;
  materialId: string;
  grams: string;
  printHours: string;
  isCustom: boolean;
  /** "Designed by …", when the product credits a designer. */
  designer: string | null;
  active: boolean;
  modelFileKey: string | null;
  imageKeys: string[];
  options: ProductOptionConfig[];
  /** The printed size grams and printHours are for, measured from the model. */
  size: SizeCm | null;
  sizes: ProductSizeView[];
  /** Base price with default options, from the current pricing settings. */
  price: Money;
}

/** A size a product is sold in (dashboard): its measurements and what it takes to print. */
export interface ProductSizeView {
  id?: string;
  label: string;
  size: SizeCm;
  grams: string;
  printHours: string;
  isDefault: boolean;
}

export interface AdminProductListItem {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  material: string;
  price: Money;
  active: boolean;
  hasModel: boolean;
  updatedAt: string;
}

/** A file accepted by POST /uploads: reference it by `key` (never by URL). */
export interface UploadedFile {
  key: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}
