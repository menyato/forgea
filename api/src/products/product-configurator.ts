import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  averagePricePerGram,
  configuredUnitPrice,
  type OptionEffect,
  overriddenUnitPrice,
  type ProfitRule,
  type UnitCostCalculator,
} from '@forgea/pricing';
import {
  type ChosenOption,
  formatSizeCm,
  type OptionSelection,
  PRODUCT_SIZE_GROUP_ID,
  type ProductOption,
  startingChoice,
} from '@forgea/types';
import { Prisma } from '../generated/prisma/client.js';
import { OptionKind, type ProfitKind } from '../generated/prisma/enums.js';

/** Everything needed to show, configure and price a product. */
export const withConfiguration = {
  material: {
    select: {
      code: true,
      name: true,
      pricePerGram: true,
      densityGPerCm3: true,
      gramsPerHour: true,
    },
  },
  // Personalised products: the colours customers choose from.
  textColourGroup: {
    include: {
      values: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
    },
  },
  category: { select: { slug: true, name: true } },
  optionGroups: {
    orderBy: { sortOrder: 'asc' },
    include: { group: true },
  },
  optionValues: {
    include: {
      value: { include: { material: { select: { pricePerGram: true } } } },
    },
    orderBy: [{ value: { sortOrder: 'asc' } }, { value: { label: 'asc' } }],
  },
  sizes: { orderBy: { sortOrder: 'asc' } },
  colours: {
    orderBy: { sortOrder: 'asc' },
    // The filament each colour is printed from, for its price.
    include: {
      stockItem: {
        select: {
          pricePerGram: true,
          material: { select: { pricePerGram: true } },
        },
      },
    },
  },
  printFiles: { orderBy: { sortOrder: 'asc' } },
  extraCosts: { orderBy: { sortOrder: 'asc' } },
  // Multi-colour products: the colours customers recolour named parts in.
  partColourGroup: {
    include: {
      values: {
        where: { active: true, swatchHex: { not: null } },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      },
    },
  },
} as const satisfies Prisma.ProductInclude;

export type ConfigurableProduct = Prisma.ProductGetPayload<{
  include: typeof withConfiguration;
}>;

/** A customer's choices, checked against the product and ready to price and store. */
export interface Configuration {
  /** Normalized: defaults filled in, in the product's option order. Stored on the cart line. */
  selections: OptionSelection[];
  /** By name, for the cart, the order snapshot and receipts. */
  chosen: ChosenOption[];
  effects: OptionEffect[];
  /** One cart line per distinct configuration of a product. */
  configKey: string;
  /** A chosen size prints with its own grams and hours instead of the product's. */
  base?: { grams: string; printHours: string };
}

/**
 * Applies the options the owner configured in the dashboard: which groups a product offers,
 * which values, the defaults, and each value's price rule. Inactive groups and values are
 * simply not offered.
 */
@Injectable()
export class ProductConfigurator {
  /** What the shop shows: the choices only, never the price rules behind them. */
  offered(product: ConfigurableProduct): ProductOption[] {
    return [
      ...this.sizeOption(product),
      ...this.groupOptions(product),
      ...this.partOptions(product),
    ];
  }

  /**
   * A multi-colour product's named parts: each a colour choice from the product's part colours,
   * starting in the choice the owner picked for it (else `startingChoice`: the same filament, the
   * same name, the closest colour). Kept apart from option groups (a part is not
   * one), with an id made from the product and the part's file colour, so saving the product
   * (which rewrites its colour rows) keeps carts' choices.
   */
  private partOptions(product: ConfigurableProduct): ProductOption[] {
    const group = product.partColourGroup;
    if (!group?.active || group.values.length === 0) return [];
    return product.colours.flatMap((c): ProductOption[] => {
      if (!c.part) return [];
      const start = startingChoice(group.values, c) ?? group.values[0]!;
      return [
        {
          groupId: partGroupId(product.id, c.hex),
          name: c.part,
          kind: OptionKind.CHOICE,
          required: true,
          maxLength: null,
          choices: group.values.map((v) => ({
            id: v.id,
            label: v.label,
            swatchHex: v.swatchHex,
          })),
          defaultValueId: start.id,
          recolours: c.hex.toLowerCase(),
        },
      ];
    });
  }

  /**
   * The product's own sizes, if it has more than one: customers choose by measurements
   * ("13 × 13 × 26 cm"); the names the owner gives them stay in the dashboard.
   */
  private sizeOption(product: ConfigurableProduct): ProductOption[] {
    if (product.sizes.length === 0) return [];
    return [
      {
        groupId: PRODUCT_SIZE_GROUP_ID,
        name: 'Size',
        kind: 'SIZE',
        required: true,
        maxLength: null,
        choices: product.sizes.map((s) => ({
          id: s.id,
          label: formatSizeCm(sizeOf(s)),
          swatchHex: null,
        })),
        defaultValueId: (
          product.sizes.find((s) => s.isDefault) ?? product.sizes[0]!
        ).id,
      },
    ];
  }

  private groupOptions(product: ConfigurableProduct): ProductOption[] {
    return this.groups(product).flatMap((pg): ProductOption[] => {
      const values = this.values(product, pg.groupId);
      if (pg.group.kind === OptionKind.CHOICE && values.length === 0) return [];
      return [
        {
          groupId: pg.groupId,
          name: pg.group.name,
          kind: pg.group.kind,
          required: pg.required,
          maxLength: pg.group.maxLength,
          choices: values.map((v) => ({
            id: v.value.id,
            label: v.value.label,
            swatchHex: v.value.swatchHex,
          })),
          defaultValueId: values.find((v) => v.isDefault)?.valueId ?? null,
        },
      ];
    });
  }

  /** The swatch a model is first shown in: the default colour, else the first one with a swatch. */
  previewColor(product: ConfigurableProduct): string | null {
    // A recoloured part's swatch isn't the model's colour: the model has its own.
    for (const option of this.offered(product).filter((o) => !o.recolours)) {
      const swatched = option.choices.filter((c) => c.swatchHex !== null);
      if (swatched.length === 0) continue;
      const chosen =
        swatched.find((c) => c.id === option.defaultValueId) ?? swatched[0]!;
      return chosen.swatchHex;
    }
    return null;
  }

  /** Throws 400 with a message for the shopper when a choice is missing or not offered. */
  configure(
    product: ConfigurableProduct,
    selections: readonly OptionSelection[],
  ): Configuration {
    const offered = new Map(this.offered(product).map((o) => [o.groupId, o]));
    const given = new Map<string, OptionSelection>();
    for (const s of selections) {
      if (!offered.has(s.groupId) || given.has(s.groupId)) {
        throw new BadRequestException('One of these options is not available');
      }
      given.set(s.groupId, s);
    }

    const result: Configuration = {
      selections: [],
      chosen: [],
      effects: [],
      configKey: '',
    };
    for (const option of offered.values()) {
      const selection = given.get(option.groupId);
      if (option.kind === 'SIZE') {
        this.applySize(product, option, selection, result);
      } else if (option.recolours) {
        this.applyPart(product, option, selection, result);
      } else if (option.kind === OptionKind.TEXT) {
        this.applyText(product, option, selection, result);
      } else {
        this.applyChoice(product, option, selection, result);
      }
    }
    result.configKey = JSON.stringify(
      [...result.selections].sort((a, b) => a.groupId.localeCompare(b.groupId)),
    );
    return result;
  }

  /**
   * The configuration a shop price is quoted for: the defaults, and for a required option
   * without one, its first choice (or a one-letter text, so a text add-on is included).
   */
  starting(product: ConfigurableProduct): Configuration {
    return this.configure(
      product,
      this.offered(product)
        .filter((o) => o.required && o.defaultValueId === null)
        .map((o): OptionSelection =>
          o.kind === OptionKind.TEXT
            ? { groupId: o.groupId, text: 'A' }
            : { groupId: o.groupId, valueId: o.choices[0]!.id },
        ),
    );
  }

  /**
   * The unit price of the product with these options (USD): calculated, or the owner's own
   * price moved by what the chosen size and options change (see `withPriceOverride`).
   */
  unitPrice(
    calculator: UnitCostCalculator,
    product: ConfigurableProduct,
    configuration: Configuration,
  ): string {
    const calculated = configuredUnitPrice(
      calculator,
      {
        grams: configuration.base?.grams ?? product.grams.toString(),
        printHours:
          configuration.base?.printHours ?? product.printHours.toString(),
        pricePerGram: filamentPricePerGram(product),
        wasteIncluded: product.slicedFile,
        extraCost: extraCostOf(product),
      },
      configuration.effects,
      profitOf(product),
    );
    return withPriceOverride(calculator, product, calculated);
  }

  private applyChoice(
    product: ConfigurableProduct,
    option: ProductOption,
    selection: OptionSelection | undefined,
    result: Configuration,
  ): void {
    if (selection?.text !== undefined) {
      throw new BadRequestException(`Choose a ${option.name} from the list`);
    }
    const valueId = selection?.valueId ?? option.defaultValueId;
    if (!valueId) {
      if (option.required)
        throw new BadRequestException(`Choose a ${option.name}`);
      return;
    }
    const v = this.values(product, option.groupId).find(
      (pv) => pv.valueId === valueId,
    )?.value;
    if (!v)
      throw new BadRequestException(`This ${option.name} is not available`);
    result.selections.push({ groupId: option.groupId, valueId });
    result.chosen.push({ group: option.name, value: v.label });
    result.effects.push({
      label: `${option.name}: ${v.label}`,
      gramsMultiplier: v.gramsMultiplier.toString(),
      hoursMultiplier: v.hoursMultiplier.toString(),
      extraPrice: v.extraPrice.toString(),
      pricePerGram: v.material?.pricePerGram.toString() ?? null,
    });
  }

  private applyText(
    product: ConfigurableProduct,
    option: ProductOption,
    selection: OptionSelection | undefined,
    result: Configuration,
  ): void {
    if (selection?.valueId !== undefined) {
      throw new BadRequestException(`Type the ${option.name}`);
    }
    const text = selection?.text?.trim() ?? '';
    if (!text) {
      if (option.required)
        throw new BadRequestException(`Enter the ${option.name}`);
      return;
    }
    if (option.maxLength !== null && text.length > option.maxLength) {
      throw new BadRequestException(
        `${option.name}: at most ${option.maxLength} characters`,
      );
    }
    const group = this.groups(product).find(
      (pg) => pg.groupId === option.groupId,
    )!.group;
    result.selections.push({ groupId: option.groupId, text });
    result.chosen.push({ group: option.name, value: text });
    result.effects.push({
      label: option.name,
      gramsMultiplier: 1,
      hoursMultiplier: 1,
      extraPrice: group.textExtraPrice.toString(),
    });
  }

  /**
   * A part's colour: the order records "Body: Copper" (stock takes the part's grams from that
   * colour) and the price adds the colour's own add-on; the grams stay the part's.
   */
  private applyPart(
    product: ConfigurableProduct,
    option: ProductOption,
    selection: OptionSelection | undefined,
    result: Configuration,
  ): void {
    if (selection?.text !== undefined) {
      throw new BadRequestException(`Choose the ${option.name}'s colour`);
    }
    const valueId = selection?.valueId ?? option.defaultValueId;
    const v = product.partColourGroup?.values.find((pv) => pv.id === valueId);
    if (!v)
      throw new BadRequestException(
        `This colour is not available for the ${option.name}`,
      );
    result.selections.push({ groupId: option.groupId, valueId: v.id });
    result.chosen.push({ group: option.name, value: v.label });
    result.effects.push({
      label: `${option.name}: ${v.label}`,
      gramsMultiplier: 1,
      hoursMultiplier: 1,
      extraPrice: v.extraPrice.toString(),
    });
  }

  /** A size: its grams and hours replace the product's; the order keeps its measurements. */
  private applySize(
    product: ConfigurableProduct,
    option: ProductOption,
    selection: OptionSelection | undefined,
    result: Configuration,
  ): void {
    if (selection?.text !== undefined) {
      throw new BadRequestException('Choose a size from the list');
    }
    const size = product.sizes.find(
      (s) => s.id === (selection?.valueId ?? option.defaultValueId),
    );
    if (!size) throw new BadRequestException('This size is not available');
    result.selections.push({ groupId: option.groupId, valueId: size.id });
    result.chosen.push({
      group: option.name,
      value: formatSizeCm(sizeOf(size)),
    });
    result.base = {
      grams: size.grams.toString(),
      printHours: size.printHours.toString(),
    };
  }

  private groups(product: ConfigurableProduct) {
    return product.optionGroups.filter((pg) => pg.group.active);
  }

  private values(product: ConfigurableProduct, groupId: string) {
    return product.optionValues.filter(
      (pv) => pv.value.groupId === groupId && pv.value.active,
    );
  }
}

/** A part's option id: stable for the product and the part's file colour (UUID-shaped). */
export function partGroupId(productId: string, hex: string): string {
  const h = createHash('sha256')
    .update(`part:${productId}:${hex.toLowerCase()}`)
    .digest('hex');
  // Version 8 (custom) and the RFC variant, so it reads as any other id.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const sizeOf = (s: {
  sizeXcm: { toString(): string };
  sizeYcm: { toString(): string };
  sizeZcm: { toString(): string };
}) => ({
  x: s.sizeXcm.toString(),
  y: s.sizeYcm.toString(),
  z: s.sizeZcm.toString(),
});

/**
 * A price worked out from the costs, or, when the owner set their own price for the product,
 * that price plus what this configuration (`calculated`) changes against the product's own
 * grams and hours.
 */
export function withPriceOverride(
  calculator: UnitCostCalculator,
  product: Pick<
    ConfigurableProduct,
    | 'priceOverride'
    | 'grams'
    | 'printHours'
    | 'material'
    | 'profitKind'
    | 'profitValue'
    | 'slicedFile'
    | 'colours'
    | 'extraCosts'
  >,
  calculated: string,
): string {
  if (product.priceOverride === null) return calculated;
  const base = configuredUnitPrice(
    calculator,
    {
      grams: product.grams.toString(),
      printHours: product.printHours.toString(),
      pricePerGram: filamentPricePerGram(product),
      wasteIncluded: product.slicedFile,
      extraCost: extraCostOf(product),
    },
    [],
    profitOf(product),
  );
  return overriddenUnitPrice(
    product.priceOverride.toString(),
    base,
    calculated,
  );
}

/**
 * What a gram of the product's filament costs: its material's price, or, when its colours are
 * printed from filaments on the shelf, each colour's grams at that filament's own price (its
 * spools as bought, else its material's), averaged over the product's grams.
 */
function filamentPricePerGram(
  product: Pick<ConfigurableProduct, 'material' | 'colours'>,
): string {
  return averagePricePerGram(
    product.material.pricePerGram.toString(),
    product.colours.map((c) => ({
      grams: c.grams.toString(),
      pricePerGram:
        c.stockItem?.pricePerGram?.toString() ??
        c.stockItem?.material.pricePerGram.toString() ??
        null,
    })),
  );
}

/** The product's own profit rule, or null for the shop's. */
export function profitOf(product: {
  profitKind: ProfitKind | null;
  profitValue: { toString(): string } | null;
}): (ProfitRule & { kind: ProfitKind; value: string }) | null {
  return product.profitKind && product.profitValue !== null
    ? { kind: product.profitKind, value: product.profitValue.toString() }
    : null;
}

/** What one piece's extra parts cost (a key ring, a lamp's wiring), USD. */
export function extraCostOf(product: {
  extraCosts?: readonly { amount: { toString(): string } }[];
}): string {
  return (product.extraCosts ?? [])
    .reduce((n, e) => n.plus(e.amount.toString()), new Prisma.Decimal(0))
    .toFixed(2);
}
