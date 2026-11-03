import type Big from 'big.js';
import {
  type DecimalInput,
  money,
  percentOf,
  requireNonNegative,
  requirePercent,
  toBig,
} from './money.js';
import { PricingError } from './errors.js';

/**
 * What the studio earns on a piece, on top of what it costs: a percentage of the cost
 * ("100%" doubles it) or a fixed amount in USD ("$4 on every keychain").
 */
export type ProfitKind = 'PERCENT' | 'FIXED';
export interface ProfitRule {
  kind: ProfitKind;
  value: DecimalInput;
}

/**
 * Cost-model settings. SERVER ONLY — these reveal the studio's cost structure and margin,
 * so the API never sends them to the browser.
 */
export interface CostSettings {
  machineRatePerHour: DecimalInput;
  purgeWastePercent: DecimalInput;
  failureAllowancePercent: DecimalInput;
  laborCostPerUnit: DecimalInput;
  packagingCostPerUnit: DecimalInput;
  /** The shop's default rule; a product may set its own. */
  profit: ProfitRule;
}

export interface UnitCostInput {
  grams: DecimalInput;
  printHours: DecimalInput;
  /** From the Material table: pricePerGram(material). */
  pricePerGram: DecimalInput;
}

/** Every component as a 2-decimal string. `unitPrice` is computed from unrounded components. */
export interface UnitPriceBreakdown {
  materialCost: string;
  machineCost: string;
  wasteCost: string;
  failureAllowance: string;
  laborCost: string;
  packagingCost: string;
  /** What it costs the studio to make. */
  subtotal: string;
  /** What the studio earns on it, by the rule applied. */
  profit: string;
  profitRule: { kind: ProfitKind; value: string };
  unitPrice: string;
}

/**
 * Turns a print job's physical inputs into a unit price:
 *
 *   materialCost     = grams × pricePerGram
 *   machineCost      = printHours × machineRate
 *   wasteCost        = (materialCost + machineCost) × purgeWaste%
 *   failureAllowance = (materialCost + machineCost) × failureAllowance%
 *   subtotal         = material + machine + waste + failure + labor + packaging
 *   profit           = subtotal × percent%  (PERCENT)  or  the amount  (FIXED)
 *   unitPrice        = subtotal + profit
 */
export class UnitCostCalculator {
  private readonly machineRate: Big;
  private readonly purgeWaste: Big;
  private readonly failureAllowance: Big;
  private readonly labor: Big;
  private readonly packaging: Big;
  private readonly profit: ProfitRule;

  constructor(settings: CostSettings) {
    this.machineRate = requireNonNegative(
      toBig(settings.machineRatePerHour, 'machineRatePerHour'),
      'machineRatePerHour',
    );
    this.purgeWaste = requirePercent(
      toBig(settings.purgeWastePercent, 'purgeWastePercent'),
      'purgeWastePercent',
    );
    this.failureAllowance = requirePercent(
      toBig(settings.failureAllowancePercent, 'failureAllowancePercent'),
      'failureAllowancePercent',
    );
    this.labor = requireNonNegative(
      toBig(settings.laborCostPerUnit, 'laborCostPerUnit'),
      'laborCostPerUnit',
    );
    this.packaging = requireNonNegative(
      toBig(settings.packagingCostPerUnit, 'packagingCostPerUnit'),
      'packagingCostPerUnit',
    );
    this.profit = checkedProfit(settings.profit, 'profit');
  }

  /** `profit` is a product's own rule; without one, the shop's default applies. */
  price(input: UnitCostInput, profit?: ProfitRule | null): UnitPriceBreakdown {
    const rule = profit ? checkedProfit(profit, 'product profit') : this.profit;
    const grams = toBig(input.grams, 'grams');
    if (grams.lte(0)) throw new PricingError('grams must be greater than 0');
    const hours = requireNonNegative(
      toBig(input.printHours, 'printHours'),
      'printHours',
    );
    const pricePerGram = requireNonNegative(
      toBig(input.pricePerGram, 'pricePerGram'),
      'pricePerGram',
    );

    const materialCost = grams.times(pricePerGram);
    const machineCost = hours.times(this.machineRate);
    const base = materialCost.plus(machineCost);
    const wasteCost = percentOf(base, this.purgeWaste);
    const failureAllowance = percentOf(base, this.failureAllowance);
    const subtotal = base
      .plus(wasteCost)
      .plus(failureAllowance)
      .plus(this.labor)
      .plus(this.packaging);
    const value = toBig(rule.value, 'profit');
    const profitAmount =
      rule.kind === 'PERCENT' ? percentOf(subtotal, value) : value;

    return {
      materialCost: money(materialCost),
      machineCost: money(machineCost),
      wasteCost: money(wasteCost),
      failureAllowance: money(failureAllowance),
      laborCost: money(this.labor),
      packagingCost: money(this.packaging),
      subtotal: money(subtotal),
      profit: money(profitAmount),
      profitRule: { kind: rule.kind, value: value.toString() },
      unitPrice: money(subtotal.plus(profitAmount)),
    };
  }
}

/** A rule that makes sense: a known kind and a value of 0 or more (a percentage up to 1000). */
function checkedProfit(rule: ProfitRule, field: string): ProfitRule {
  if (rule.kind !== 'PERCENT' && rule.kind !== 'FIXED') {
    throw new PricingError(`${field} must be a percentage or a fixed amount`);
  }
  const value = requireNonNegative(toBig(rule.value, field), field);
  if (rule.kind === 'PERCENT' && value.gt(1000)) {
    throw new PricingError(`${field} must be at most 1000%`);
  }
  return { kind: rule.kind, value: value.toString() };
}
