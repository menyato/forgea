import { BadRequestException, Injectable } from '@nestjs/common';
import {
  configuredUnitPrice,
  type OptionEffect,
  type UnitCostCalculator,
} from '@forgea/pricing';
import type {
  ChosenOption,
  OptionSelection,
  ProductOption,
} from '@forgea/types';
import type { Prisma } from '../generated/prisma/client.js';
import { OptionKind } from '../generated/prisma/enums.js';

/** Everything needed to show, configure and price a product. */
export const withConfiguration = {
  material: { select: { code: true, name: true, pricePerGram: true } },
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
    for (const option of this.offered(product)) {
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
      if (option.kind === OptionKind.TEXT) {
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

  /** The unit price of the product with these options (USD). */
  unitPrice(
    calculator: UnitCostCalculator,
    product: ConfigurableProduct,
    configuration: Configuration,
  ): string {
    return configuredUnitPrice(
      calculator,
      {
        grams: product.grams.toString(),
        printHours: product.printHours.toString(),
        pricePerGram: product.material.pricePerGram.toString(),
      },
      configuration.effects,
    );
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

  private groups(product: ConfigurableProduct) {
    return product.optionGroups.filter((pg) => pg.group.active);
  }

  private values(product: ConfigurableProduct, groupId: string) {
    return product.optionValues.filter(
      (pv) => pv.value.groupId === groupId && pv.value.active,
    );
  }
}
