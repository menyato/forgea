import type { OptionKind, ProfitKind } from './generated/prisma/enums.js';
import type { ShownColour } from './parts.js';
import type { Money, ProductListItem } from './lists.js';
import type { DesignSlot } from '@forgea/text3d/design';
import type {
  ProductSlotsOffer,
  ProductTextOffer,
  ProductTextSettings,
} from './text-studio.js';

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
  /** One reel as bought; pricePerGram is its price ÷ its weight. */
  reelPrice: string | null;
  reelGrams: number | null;
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
  /** A colour printed from this filament on the shelf: orders take its grams there. */
  stockItemId: string | null;
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
  /**
   * A part of a multi-colour (3MF) product the customer recolours: the file's colour of that
   * part (#rrggbb), which the 3D view swaps for the chosen swatch.
   */
  recolours?: string;
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
  /** Personalised: the customer designs their text (fonts, colours) and sees it in 3D. */
  text: ProductTextOffer | null;
  /** Text and logos on its model; null when it has none. */
  slots: ProductSlotsOffer | null;
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
  /** Personalised text: how its pieces are made; null = a regular product. */
  text: ProductTextSettings | null;
  /** Its own profit rule; null = the shop's (Pricing page). */
  profit: { kind: ProfitKind; value: string } | null;
  /** The owner's own price in place of the calculated one; null = calculated. */
  priceOverride: Money | null;
  /** What else one piece costs (a key ring, a lamp's wiring), added to its cost. */
  extraCosts: { label: string; amount: Money }[];
  /** Multi-colour (from its 3MF): grams per colour at its own size; empty = one colour. */
  colours: ProductColourView[];
  /** The colours customers recolour its named parts in (an option group); null = none. */
  partColourGroupId: string | null;
  /** Its grams and time are its sliced 3MF's own: purge, prime tower and supports included. */
  slicedFile: boolean;
  /** Its sliced print files, when it is printed from other files than its model. */
  printFiles: ProductPrintFileView[];
  /** Base price with default options, from the current pricing settings. */
  price: Money;
  /** Text and logos added to its model, and which ones customers may change. */
  slots: DesignSlot[];
}

/** What one filament colour takes for one piece of a multi-colour product. */
export interface ProductColourView {
  /** The colour as the shop names it: its stock line. */
  colour: string;
  /** #rrggbb. */
  hex: string;
  grams: string;
  /** What customers call this part when they choose its colour; null = always `colour`. */
  part: string | null;
  /** The choice the part starts in on the product page (a label); null = automatic. */
  startsAs: string | null;
  /**
   * The filament on the shelf it is printed from (a stock line: its material, name and price);
   * null = the product's material in the colour named.
   */
  stockItemId: string | null;
}

/**
 * A piece made from a 3MF (a quotation line, a custom request, their order lines): the file
 * and what one piece takes, read by the API from the file itself. Stock takes each colour's
 * grams; staff download the file from the order.
 */
export interface PrintFile {
  /** The 3MF's object key. */
  fileKey: string;
  materialId: string;
  /** True when grams and time are the slicer's own; false: estimated from the volume. */
  sliced: boolean;
  grams: string;
  printHours: string;
  /** Each colour as the shop names it (its stock line), the file's #rrggbb and its grams. */
  colours: { colour: string; hex: string; grams: string }[];
}

/**
 * POST /products/model-info: what a 3MF says about printing it, with grams and hours worked
 * out in the chosen material. A sliced file (Bambu Studio "Export plate sliced file") gives
 * the slicer's own time and grams; otherwise they are estimated from the volume.
 */
export interface ModelFileInfo {
  /** Width × depth × height, cm. */
  size: SizeCm;
  /** True when the time and grams are the slicer's; false: estimated from the volume. */
  sliced: boolean;
  grams: string;
  printHours: string;
  colours: {
    /** #rrggbb, the file's filament colour. */
    hex: string;
    /** PLA, PETG…, as the file says. */
    type: string | null;
    grams: string;
    /** The closest colour the shop sells (a swatch's label), when there is one. */
    suggested: string | null;
  }[];
  setup: PrintSetup;
}

/** How a 3MF was set up to print, as its slicer says; each field only when the file has it. */
export interface PrintSetup {
  /** Sliced plates in the file (0: never sliced). */
  plates: number;
  supports: boolean;
  primeTower: boolean;
  /** "Bambu Lab X2D". */
  printer: string | null;
  nozzleMm: number | null;
  layerHeightMm: number | null;
  /** "15%". */
  infill: string | null;
  /** The print profile ("0.12mm Fine @BBL X2D"). */
  profile: string | null;
  /** The objects on its plates, by name. */
  objects: string[];
}

/**
 * A product's sliced print file (staff only): what the slicer says it takes, purge, prime tower
 * and supports included, and how it was set up. A product shown assembled is printed from one
 * or more of these; together they are its grams, time and colours.
 */
export interface ProductPrintFileView {
  fileKey: string;
  /** What the owner calls it ("Base", "Shade"). */
  name: string;
  grams: string;
  printHours: string;
  /** Each colour as the shop names it (else the file's #rrggbb), with its grams. */
  colours: {
    colour: string;
    hex: string;
    type: string | null;
    grams: string;
  }[];
  setup: PrintSetup;
}

/** POST /products/print-files: the files read, and what they take together. */
export interface PrintFilesTotal {
  files: ProductPrintFileView[];
  grams: string;
  printHours: string;
  /** Colours of the same name added up, in the order first met. */
  colours: { colour: string; hex: string; grams: string }[];
}

/**
 * POST /products/price-preview: what a product would sell at, from its grams, hours, material
 * and profit rule, while it is being edited. The breakdown only for whoever manages pricing.
 */
export interface PricePreview {
  /** What it sells at: the owner's price when set, else the calculated one. */
  unitPrice: Money;
  /** What the costs and profit rule work out to, whatever the owner's price. */
  calculatedPrice: Money;
  /** The grams and time are the sliced 3MF's own: no purge waste added on top. */
  wasteIncluded: boolean;
  breakdown: {
    material: Money;
    /** Printer time: its wear and its electricity together. */
    printer: Money;
    /** The printer's price spread over its life, and the electricity it draws (both add up
     *  to `printer`); null when the hourly cost was typed in on the Pricing page. */
    printerWear: Money | null;
    electricity: Money | null;
    wasteAndFailures: Money;
    labour: Money;
    packaging: Money;
    /** The product's extra costs (parts besides the print). */
    extras: Money;
    /** Everything above: what one piece costs to make. */
    cost: Money;
    profit: Money;
    profitRule: { kind: ProfitKind; value: string };
  } | null;
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
  /** Its 3D model, and the colour a one-colour model is first shown in: as the shop shows it. */
  modelKey: string | null;
  previewColor: string | null;
  /** The colours it starts in (each part's starting choice), shown beside its model. */
  colours: ShownColour[];
  updatedAt: string;
}

/**
 * GET /products/quotable: a product a quotation line may be made from, launched in the shop or
 * not (a piece made for one client), with what it sells at.
 */
export interface QuotableProduct {
  id: string;
  slug: string;
  name: string;
  price: Money;
  /** False: hidden from the shop; only the studio can put it on a quotation. */
  active: boolean;
}

/** GET /products/quotable/:slug/sizes: one of its real sizes, with its price. */
export interface QuotableSize {
  id: string;
  /** "18 × 12 × 9 cm". */
  label: string;
  x: string;
  y: string;
  z: string;
  unitPrice: Money;
}

/** A file accepted by POST /uploads: reference it by `key` (never by URL). */
export interface UploadedFile {
  key: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}
