import {
  configuredUnitCost,
  type OptionEffect,
  PricingError,
  type UnitCostCalculator,
} from '@forgea/pricing';
import { type ChosenOption, formatSizeCm } from '@forgea/types';

/** What the catalog says about a product, today. */
interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  grams: string;
  printHours: string;
  materialId: string;
  /**
   * Multi-colour (from its 3MF): grams per colour at its own size; empty = one colour. A named
   * part prints in the colour the order chose for it ("Body: Copper"), else in `colour`.
   */
  colours: { colour: string; grams: string; part: string | null }[];
  /** Measurements as the order stores them ("18 × 12 × 9 cm"), in the product's order. */
  sizes: {
    label: string;
    grams: string;
    printHours: string;
    isDefault: boolean;
  }[];
}

/** A choice from an option group ("Colour" → "Copper"), with its price rule. */
interface CatalogValue {
  gramsMultiplier: string;
  hoursMultiplier: string;
  materialId: string | null;
  /** Values with a swatch are colours: the filament's colour. */
  swatchHex: string | null;
}

export interface Catalog {
  products: ReadonlyMap<string, CatalogProduct>;
  /** By `valueKey(group, value)`. */
  values: ReadonlyMap<string, CatalogValue>;
  pricePerGram: ReadonlyMap<string, string>;
}

/** What one unit of an order line takes to make. */
export interface ItemEstimate {
  /** Cost before markup, USD, estimated with today's pricing settings. */
  unitCost: string;
  gramsPerUnit: string;
  /** Print time for one piece (hours): the print jobs' estimate. */
  hoursPerUnit: string;
  materialId: string;
  /** The chosen colour (a value with a swatch); "" when none. */
  colour: string;
  /** A multi-colour piece (personalised text, a 3MF product): the grams each colour takes. */
  colours?: { colour: string; gramsPerUnit: string }[];
}

export const valueKey = (group: string, value: string) =>
  `${group}\u0000${value}`;

/** A product's sizes as orders store them: by measurements. */
export const sizeLabel = (s: {
  sizeXcm: { toString(): string };
  sizeYcm: { toString(): string };
  sizeZcm: { toString(): string };
}) =>
  formatSizeCm({
    x: s.sizeXcm.toString(),
    y: s.sizeYcm.toString(),
    z: s.sizeZcm.toString(),
  });

/**
 * An order line's production cost and filament, from the options it was bought with (stored by
 * name) and the catalog as it is today: the chosen size's grams and hours (or the product's),
 * each option's multipliers and material, then the pricing engine's cost before markup. Null
 * when the line can't be estimated (no catalog product, or a product that can't be priced).
 */
export function estimateItem(
  catalog: Catalog,
  calculator: UnitCostCalculator,
  productId: string | null,
  options: readonly ChosenOption[],
): ItemEstimate | null {
  const product = productId ? catalog.products.get(productId) : undefined;
  if (!product) return null;
  const size =
    product.sizes.find((s) => options.some((o) => o.value === s.label)) ??
    product.sizes.find((s) => s.isDefault) ??
    product.sizes[0];
  const effects: OptionEffect[] = [];
  let materialId = product.materialId;
  let colour = '';
  // Parts recoloured by the customer: their choice is the part's filament, not an option.
  const parts = new Set(
    product.colours.flatMap((c) => (c.part ? [c.part] : [])),
  );
  for (const o of options) {
    if (parts.has(o.group)) continue;
    const v = catalog.values.get(valueKey(o.group, o.value));
    if (!v) continue;
    if (v.materialId) materialId = v.materialId;
    if (v.swatchHex !== null && colour === '') colour = o.value;
    effects.push({
      label: `${o.group}: ${o.value}`,
      gramsMultiplier: v.gramsMultiplier,
      hoursMultiplier: v.hoursMultiplier,
      extraPrice: 0,
      pricePerGram: v.materialId
        ? (catalog.pricePerGram.get(v.materialId) ?? null)
        : null,
    });
  }
  const pricePerGram = catalog.pricePerGram.get(product.materialId);
  if (pricePerGram === undefined) return null;
  try {
    const { cost, grams, hours } = configuredUnitCost(
      calculator,
      {
        grams: size?.grams ?? product.grams,
        printHours: size?.printHours ?? product.printHours,
        pricePerGram,
      },
      effects,
    );
    // A multi-colour product: its grams (at the chosen size and options) shared out as its
    // colours share its own grams.
    const colours = splitByColour(
      product.colours.map((c) => ({
        colour:
          (c.part && options.find((o) => o.group === c.part)?.value) ||
          c.colour,
        grams: c.grams,
      })),
      grams,
    );
    return {
      unitCost: cost,
      gramsPerUnit: grams,
      hoursPerUnit: hours,
      materialId,
      colour: colours?.[0]?.colour ?? colour,
      ...(colours ? { colours } : {}),
    };
  } catch (error) {
    if (error instanceof PricingError) return null;
    throw error;
  }
}

/** `grams` shared out in proportion to a product's colours; null for a one-colour product. */
function splitByColour(
  colours: readonly { colour: string; grams: string }[],
  grams: string,
): { colour: string; gramsPerUnit: string }[] | null {
  const total = colours.reduce((n, c) => n + Number(c.grams), 0);
  if (colours.length === 0 || total <= 0) return null;
  // Two parts chosen in the same colour come from one reel.
  const byColour = new Map<string, number>();
  for (const c of colours)
    byColour.set(c.colour, (byColour.get(c.colour) ?? 0) + Number(c.grams));
  return [...byColour].map(([colour, g]) => ({
    colour,
    gramsPerUnit: ((Number(grams) * g) / total).toFixed(2),
  }));
}
