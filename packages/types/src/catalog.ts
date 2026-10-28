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

/** One option a product offers, as the shop shows it (no price rules: those stay server-side). */
export interface ProductOption {
  groupId: string;
  name: string;
  kind: OptionKind;
  required: boolean;
  maxLength: number | null;
  choices: { id: string; label: string; swatchHex: string | null }[];
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
  /** Base price with default options, from the current pricing settings. */
  price: Money;
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
