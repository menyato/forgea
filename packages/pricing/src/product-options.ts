import Big from 'big.js';
import { PricingError } from './errors.js';
import {
  type DecimalInput,
  money,
  requireNonNegative,
  toBig,
} from './money.js';
import type {
  ProfitRule,
  UnitCostCalculator,
  UnitCostInput,
} from './unit-cost-calculator.js';

/**
 * What one chosen option does to the price, as the admin configured it in the dashboard.
 * A "Large" size might scale grams ×1.8 and hours ×1.6; "Copper silk" might add $2; a
 * material option switches the price per gram.
 */
export interface OptionEffect {
  /** For error messages, e.g. "Size: Large". */
  label: string;
  gramsMultiplier: DecimalInput;
  hoursMultiplier: DecimalInput;
  /** Added to the unit selling price after markup (USD). */
  extraPrice: DecimalInput;
  /** Set when this option switches the material: that material's price per gram. */
  pricePerGram?: DecimalInput | null | undefined;
}

export interface ConfiguredUnit {
  /** The print inputs after every option is applied, for the cost calculator. */
  input: { grams: string; printHours: string; pricePerGram: string };
  /** Sum of the options' fixed add-ons. */
  extraPrice: string;
}

/**
 * Applies the chosen options to a product's base inputs. Multipliers compound (a large size in
 * a dense material scales twice); at most one option may set the material.
 */
export function configureUnit(
  base: UnitCostInput,
  effects: readonly OptionEffect[],
): ConfiguredUnit {
  let grams = toBig(base.grams, 'grams');
  let hours = toBig(base.printHours, 'printHours');
  let pricePerGram = toBig(base.pricePerGram, 'pricePerGram');
  let extra = new Big(0);
  let materialFrom: string | undefined;

  for (const e of effects) {
    grams = grams.times(
      positive(e.gramsMultiplier, `${e.label}: grams multiplier`),
    );
    hours = hours.times(
      positive(e.hoursMultiplier, `${e.label}: hours multiplier`),
    );
    extra = extra.plus(
      requireNonNegative(
        toBig(e.extraPrice, `${e.label}: extra price`),
        `${e.label}: extra price`,
      ),
    );
    if (e.pricePerGram !== null && e.pricePerGram !== undefined) {
      if (materialFrom) {
        throw new PricingError(
          `Both "${materialFrom}" and "${e.label}" set the material`,
        );
      }
      materialFrom = e.label;
      pricePerGram = requireNonNegative(
        toBig(e.pricePerGram, `${e.label}: price per gram`),
        `${e.label}: price per gram`,
      );
    }
  }
  return {
    input: {
      grams: grams.round(3).toString(),
      printHours: hours.round(3).toString(),
      pricePerGram: pricePerGram.toString(),
      ...(base.wasteIncluded ? { wasteIncluded: true } : {}),
    },
    extraPrice: money(extra),
  };
}

/**
 * The unit price of a configured product: the calculator's price (with the product's own
 * profit rule, or the shop's) plus the fixed add-ons.
 */
export function configuredUnitPrice(
  calculator: UnitCostCalculator,
  base: UnitCostInput,
  effects: readonly OptionEffect[],
  profit?: ProfitRule | null,
): string {
  const { input, extraPrice } = configureUnit(base, effects);
  return money(
    new Big(calculator.price(input, profit).unitPrice).plus(extraPrice),
  );
}

/**
 * What making one configured unit costs the studio (the calculator's subtotal: material,
 * machine, waste, failures, labour and packaging, before markup), and the grams and print
 * hours it takes.
 * Option add-ons are pure margin, so they never count as cost.
 */
export function configuredUnitCost(
  calculator: UnitCostCalculator,
  base: UnitCostInput,
  effects: readonly OptionEffect[],
): { cost: string; grams: string; hours: string } {
  const { input } = configureUnit(base, effects);
  return {
    cost: calculator.price(input).subtotal,
    grams: input.grams,
    hours: String(input.printHours),
  };
}

function positive(value: DecimalInput, field: string): Big {
  const n = toBig(value, field);
  if (n.lte(0)) throw new PricingError(`${field} must be greater than 0`);
  return n;
}

/**
 * The owner's own price for a product in place of the calculated one, moved by what the
 * customer's choices change in the calculated price: a bigger size, a heavier option, an
 * add-on or a longer personalised text still costs more (a smaller one less). `calculatedBase`
 * is the calculated price at the product's own grams and hours with no options;
 * `calculatedChosen` the calculated price of what the customer chose. Never below zero.
 */
export function overriddenUnitPrice(
  override: DecimalInput,
  calculatedBase: DecimalInput,
  calculatedChosen: DecimalInput,
): string {
  const price = toBig(override, 'price override')
    .plus(toBig(calculatedChosen, 'calculated price'))
    .minus(toBig(calculatedBase, 'calculated price'));
  return money(price.lt(0) ? new Big(0) : price);
}

/**
 * What a gram costs over several filaments: each one's grams at its own price (null = the
 * material's `base` price), averaged by weight. Without colours, or with none weighing
 * anything, the base price itself. Six decimals, so grams × price loses nothing.
 */
export function averagePricePerGram(
  base: DecimalInput,
  colours: readonly {
    grams: DecimalInput;
    pricePerGram: DecimalInput | null;
  }[],
): string {
  const basePrice = toBig(base, 'pricePerGram');
  let grams = new Big(0);
  let cost = new Big(0);
  for (const c of colours) {
    const g = toBig(c.grams, 'grams');
    grams = grams.plus(g);
    cost = cost.plus(
      g.times(
        c.pricePerGram === null
          ? basePrice
          : toBig(c.pricePerGram, 'pricePerGram'),
      ),
    );
  }
  return (grams.gt(0) ? cost.div(grams) : basePrice).round(6).toString();
}
