/**
 * Plain values shared by the DTO classes, the API and the storefront's browser code.
 * No decorators or validation library here, so client bundles can import
 * `@forgea/validation/constants` without pulling in class-validator.
 */

/** NIST SP 800-63B: length matters more than composition rules. 128 caps hashing cost. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** RFC 5321 limit for a full address. */
export const EMAIL_MAX_LENGTH = 254;

export const CART_QUANTITY_MAX = 999;
/** Lebanese and international numbers: digits, spaces, dashes, parentheses, optional leading +. */

/**
 * A positive decimal with up to 12 integer and 8 fractional digits, as a string so no
 * precision is lost in JSON (e.g. "89500", "0.92").
 */
export const POSITIVE_RATE = /^(?!0+(\.0+)?$)\d{1,12}(\.\d{1,8})?$/;

/** Budget choices on the custom-design form, in USD. */
export const BUDGET_RANGES = [
  'under-100',
  '100-500',
  '500-2500',
  'over-2500',
] as const;
export type BudgetRange = (typeof BUDGET_RANGES)[number];

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const PRODUCT_SORTS = ['createdAt', 'name'] as const;
export const ORDER_SORTS = ['createdAt', 'total'] as const;
export const PRINT_JOB_SORTS = ['createdAt'] as const;
export const LEAD_SORTS = ['createdAt', 'name'] as const;
export const QUOTATION_SORTS = ['createdAt', 'number', 'validUntil'] as const;
export const CUSTOM_REQUEST_SORTS = ['createdAt', 'title'] as const;
export const AUDIT_LOG_SORTS = ['timestamp'] as const;
export const INVOICE_SORTS = ['date', 'number', 'total', 'residual'] as const;
/** The invoice list's filters: still owed, settled, credit notes (several add up). */
export const INVOICE_FILTERS = ['draft', 'unpaid', 'paid', 'credit'] as const;
export const ENTRY_SORTS = ['date', 'number'] as const;
export const STOCK_MOVEMENT_SORTS = ['createdAt', 'grams'] as const;

/** "FG-" + 10 Crockford base-32 characters (no I, L, O or U). Also enforced by the database. */
/** "FG-2026-0001" (the year, then a running count); older orders kept a random one. */
export const ORDER_NUMBER_PATTERN =
  /^FG-([0-9]{4}-[0-9]{4,}|[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10})$/;
export const STATUS_NOTE_MAX_LENGTH = 500;

// Catalog (dashboard). Decimals are strings, as in the database.
/** URL-safe lowercase words joined by dashes: "phone-stand". */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Zero or more, up to 2 decimals: prices and add-ons in USD. */
export const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
/** Greater than zero, up to 2 decimals: a price the owner sets in place of the calculated one. */
export const POSITIVE_MONEY_PATTERN = /^(?!0+(\.0+)?$)\d{1,8}(\.\d{1,2})?$/;
/** Greater than zero, up to 3 decimals: option multipliers ("1.8"), grams, hours, density. */
export const POSITIVE_DECIMAL = /^(?!0+(\.0+)?$)\d{1,6}(\.\d{1,3})?$/;
/** Zero or more, up to 3 decimals: print hours may be 0 for bought-in parts. */
export const DECIMAL_PATTERN = /^\d{1,6}(\.\d{1,3})?$/;
/** Up to 4 decimals: price per gram ("0.0350"). */
export const PRICE_PER_GRAM_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
/** Object keys of accepted uploads, as POST /uploads returns them. */
export const STORAGE_KEY_PATTERN = /^clean\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

/**
 * Compressed copies of an uploaded 3D model, made by the API: `view` keeps every detail (the
 * product page), `lite` is simplified (shop cards, the home page bed). The upload itself
 * stays the original, for printing and exact measuring.
 */
export type ModelVariant = 'view' | 'lite';
const MODEL_VARIANT_KEY = /^(clean\/[0-9a-f-]{36})\.(view|lite)\.glb$/;

/** The key of a model's compressed copy: clean/<id>.stl → clean/<id>.lite.glb. */
export function modelVariantKey(key: string, variant: ModelVariant): string {
  return key.replace(/\.[a-z0-9]{2,5}$/, `.${variant}.glb`);
}

/** What /media serves: an accepted upload, or a compressed copy of a model. */
export function isMediaKey(key: string): boolean {
  return STORAGE_KEY_PATTERN.test(key) || MODEL_VARIANT_KEY.test(key);
}

/** For a compressed copy's key: the upload's id part ("clean/<id>") and which copy. */
export function parseModelVariantKey(
  key: string,
): { stem: string; variant: ModelVariant } | null {
  const match = MODEL_VARIANT_KEY.exec(key);
  return match ? { stem: match[1]!, variant: match[2] as ModelVariant } : null;
}
export const PRODUCT_IMAGES_MAX = 8;
export const OPTION_TEXT_MAX_LENGTH = 200;
export const MATERIAL_CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

// Dashboard (Phase 8b). Ranges match the database CHECK constraints.
/** A percentage from 0 to 100, up to two decimals. */
export const PERCENT_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;
/** Custom request numbers, e.g. "CR-7K2M9QX4PB" (same alphabet as order numbers). */
export const REQUEST_NUMBER_PATTERN = /^CR-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;
export const REQUEST_TITLE_MAX_LENGTH = 120;
export const REQUEST_DESCRIPTION_MAX_LENGTH = 4000;
export const REQUEST_QUANTITY_MAX = 1000;
/** The largest upload limit the owner can set for customer files, in MB. */
export const CUSTOM_UPLOAD_CEILING_MB = 100;

/** A printed size in cm: 0.1 to 9999.9, one decimal at most (quotations, product sizes). */
export const SIZE_CM_PATTERN = /^(?!0+(\.0)?$)\d{1,4}(\.\d)?$/;
/** Sizes a product can be sold in. */
export const PRODUCT_SIZES_MAX = 10;
/** Filament colours one product may print in (a multi-colour 3MF). */
export const PRODUCT_COLOURS_MAX = 16;

/** Filament stock: a colour as the shop names it, and the most grams one movement may move. */
export const STOCK_COLOUR_MAX_LENGTH = 40;
export const STOCK_GRAMS_MAX = 1_000_000;
