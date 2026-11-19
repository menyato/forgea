import Big from 'big.js';
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
  /**
   * What shop prices round to, half up (USD): "1.00" makes $4.70 → $5 and $4.40 → $4.
   * Absent: cents.
   */
  priceStep?: DecimalInput | undefined;
}

export interface UnitCostInput {
  grams: DecimalInput;
  printHours: DecimalInput;
  /** From the Material table: pricePerGram(material). */
  pricePerGram: DecimalInput;
  /**
   * The grams and time are a slicer's own (a sliced 3MF): they already hold the purge, prime
   * tower and supports, so no purge waste is added on top.
   */
  wasteIncluded?: boolean | undefined;
  /**
   * What else one piece costs besides filament and machine (the product's extra costs: a key
   * ring, a lamp's wiring), USD. Part of the cost, so the profit rule applies to it.
   */
  extraCost?: DecimalInput | undefined;
}

/** Every component as a 2-decimal string. `unitPrice` is computed from unrounded components. */
export interface UnitPriceBreakdown {
  materialCost: string;
  machineCost: string;
  wasteCost: string;
  failureAllowance: string;
  laborCost: string;
  packagingCost: string;
  /** The product's own extra costs (parts besides the print). */
  extraCost: string;
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
 *   wasteCost        = (materialCost + machineCost) × purgeWaste%  (0 when wasteIncluded)
 *   failureAllowance = (materialCost + machineCost) × failureAllowance%
 *   subtotal         = material + machine + waste + failure + labor + packaging + extras
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
  private readonly priceStep: Big;

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
    this.priceStep = toBig(settings.priceStep ?? '0.01', 'priceStep');
    if (this.priceStep.lt('0.01'))
      throw new PricingError('priceStep must be at least 0.01');
  }

  /** A price as the shop charges it: rounded half up to the shop's step (`priceStep`). */
  shopPrice(price: DecimalInput): string {
    const steps = toBig(price, 'price')
      .div(this.priceStep)
      .round(0, Big.roundHalfUp);
    return money(steps.times(this.priceStep));
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
    const wasteCost = input.wasteIncluded
      ? base.times(0)
      : percentOf(base, this.purgeWaste);
    const failureAllowance = percentOf(base, this.failureAllowance);
    const extraCost = requireNonNegative(
      toBig(input.extraCost ?? 0, 'extraCost'),
      'extraCost',
    );
    const subtotal = base
      .plus(wasteCost)
      .plus(failureAllowance)
      .plus(this.labor)
      .plus(this.packaging)
      .plus(extraCost);
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
      extraCost: money(extraCost),
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
