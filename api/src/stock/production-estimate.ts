import {
  averagePricePerGram,
  configuredUnitCost,
  type OptionEffect,
  PricingError,
  type UnitCostCalculator,
} from '@forgea/pricing';
import { type ChosenOption, formatSizeCm, type PriceLine } from '@forgea/types';

/** What the catalog says about a product, today. */
interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  grams: string;
  printHours: string;
  materialId: string;
  /** Grams and time are its sliced 3MF's own: no purge waste on top. */
  slicedFile: boolean;
  /** Its extra parts (a key ring, a lamp's wiring), USD per piece. */
  extraCost: string;
  /** The shop's price lines it leaves out (no packaging…): not part of its cost either. */
  priceLinesOff: PriceLine[];
  /**
   * Multi-colour (from its 3MF): grams per colour at its own size; empty = one colour. A named
   * part prints in the colour the order chose for it ("Body: Copper"), else in `colour`.
   */
  colours: {
    colour: string;
    grams: string;
    part: string | null;
    /**
     * The filament on the shelf it is printed from: its material, its name there and what a
     * gram of it costs. Null = the product's material in the colour named.
     */
    filament: Filament | null;
  }[];
  /** The option group its parts are recoloured from (the choices' filaments are there). */
  partColourGroup: string | null;
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
  /** The filament on the shelf this colour is printed from, when the owner linked one. */
  filament: Filament | null;
}

/** A filament on the shelf: its material, its name there and what a gram of it costs. */
interface Filament {
  materialId: string;
  colour: string;
  pricePerGram: string;
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
  /**
   * A multi-colour piece (personalised text, a 3MF product): the grams each colour takes, and
   * its material when the colour is printed from a filament of another one (PETG supports).
   */
  colours?: { colour: string; gramsPerUnit: string; materialId?: string }[];
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
  // The one colour chosen for a one-colour product, when it is printed from a filament.
  let colourFilament: Filament | null = null;
  // Parts recoloured by the customer: their choice is the part's filament, not an option.
  const parts = new Set(
    product.colours.flatMap((c) => (c.part ? [c.part] : [])),
  );
  for (const o of options) {
    if (parts.has(o.group)) continue;
    const v = catalog.values.get(valueKey(o.group, o.value));
    if (!v) continue;
    if (v.materialId) materialId = v.materialId;
    if (v.swatchHex !== null && colour === '') {
      colour = o.value;
      colourFilament = v.filament;
    }
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
  const materialPrice = catalog.pricePerGram.get(product.materialId);
  if (materialPrice === undefined) return null;
  // A part the customer recoloured prints in the colour chosen; any other colour in the
  // filament assigned to it, at that filament's own price.
  const chosen = (c: CatalogProduct['colours'][number]) =>
    (c.part && options.find((o) => o.group === c.part)?.value) || null;
  // Where a colour row prints: the customer's colour (in its own filament when the owner
  // linked one), else the filament assigned to the row, else the row's colour by name.
  const reelOf = (
    c: CatalogProduct['colours'][number],
  ): { colour: string; filament: Filament | null } => {
    const picked = chosen(c);
    if (picked) {
      const filament = product.partColourGroup
        ? (catalog.values.get(valueKey(product.partColourGroup, picked))
            ?.filament ?? null)
        : null;
      return { colour: filament?.colour ?? picked, filament };
    }
    if (c.filament) return { colour: c.filament.colour, filament: c.filament };
    return { colour: c.colour, filament: null };
  };
  const pricePerGram = averagePricePerGram(
    materialPrice,
    product.colours.length > 0
      ? product.colours.map((c) => ({
          grams: c.grams,
          pricePerGram: reelOf(c).filament?.pricePerGram ?? null,
        }))
      : // One colour, chosen as an option: its filament's price for all of it.
        [{ grams: '1', pricePerGram: colourFilament?.pricePerGram ?? null }],
  );
  try {
    const { cost, grams, hours } = configuredUnitCost(
      calculator,
      {
        grams: size?.grams ?? product.grams,
        printHours: size?.printHours ?? product.printHours,
        pricePerGram,
        wasteIncluded: product.slicedFile,
        extraCost: product.extraCost,
        off: product.priceLinesOff,
      },
      effects,
    );
    // A multi-colour product: its grams (at the chosen size and options) shared out as its
    // colours share its own grams.
    // A one-colour file sold with a shop colour option prints in the colour chosen there.
    const single = product.colours.length === 1 && colour !== '';
    const colours = splitByColour(
      product.colours.map((c) => {
        const reel = reelOf(c);
        if (reel.filament)
          return {
            colour: reel.colour,
            grams: c.grams,
            materialId: reel.filament.materialId,
          };
        return {
          colour: single && !c.part && !chosen(c) ? colour : reel.colour,
          grams: c.grams,
        };
      }),
      grams,
    );
    // A one-colour product in a colour printed from a filament: that filament's shelf.
    const oneReel = !colours && colourFilament ? colourFilament : null;
    return {
      unitCost: cost,
      gramsPerUnit: grams,
      hoursPerUnit: hours,
      materialId: oneReel?.materialId ?? materialId,
      colour: colours?.[0]?.colour ?? oneReel?.colour ?? colour,
      ...(colours ? { colours } : {}),
    };
  } catch (error) {
    if (error instanceof PricingError) return null;
    throw error;
  }
}

/** `grams` shared out in proportion to a product's colours; null for a one-colour product. */
function splitByColour(
  colours: readonly { colour: string; grams: string; materialId?: string }[],
  grams: string,
): { colour: string; gramsPerUnit: string; materialId?: string }[] | null {
  const total = colours.reduce((n, c) => n + Number(c.grams), 0);
  if (colours.length === 0 || total <= 0) return null;
  // Two parts chosen in the same colour (of the same material) come from one reel.
  const reels = new Map<
    string,
    { colour: string; materialId?: string; grams: number }
  >();
  for (const c of colours) {
    const key = `${c.materialId ?? ''}\u0000${c.colour}`;
    const reel = reels.get(key) ?? {
      colour: c.colour,
      ...(c.materialId ? { materialId: c.materialId } : {}),
      grams: 0,
    };
    reel.grams += Number(c.grams);
    reels.set(key, reel);
  }
  return [...reels.values()].map(({ grams: g, ...reel }) => ({
    ...reel,
    gramsPerUnit: ((Number(grams) * g) / total).toFixed(2),
  }));
}
