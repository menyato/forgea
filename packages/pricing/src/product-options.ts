import Big from 'big.js';
import { PricingError } from './errors.js';
import {
  type DecimalInput,
  money,
  requireNonNegative,
  toBig,
} from './money.js';
import type {
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
    },
    extraPrice: money(extra),
  };
}

/** The unit price of a configured product: the calculator's price plus the fixed add-ons. */
export function configuredUnitPrice(
  calculator: UnitCostCalculator,
  base: UnitCostInput,
  effects: readonly OptionEffect[],
): string {
  const { input, extraPrice } = configureUnit(base, effects);
  return money(new Big(calculator.price(input).unitPrice).plus(extraPrice));
}

/**
 * What making one configured unit costs the studio (the calculator's subtotal: material,
 * machine, waste, failures, labour and packaging, before markup), and the grams it takes.
 * Option add-ons are pure margin, so they never count as cost.
 */
export function configuredUnitCost(
  calculator: UnitCostCalculator,
  base: UnitCostInput,
  effects: readonly OptionEffect[],
): { cost: string; grams: string } {
  const { input } = configureUnit(base, effects);
  return { cost: calculator.price(input).subtotal, grams: input.grams };
}

function positive(value: DecimalInput, field: string): Big {
  const n = toBig(value, field);
  if (n.lte(0)) throw new PricingError(`${field} must be greater than 0`);
  return n;
}
