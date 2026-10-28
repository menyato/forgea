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
 * Cost-model settings. SERVER ONLY — these reveal the studio's cost structure and margin,
 * so the API never sends them to the browser.
 */
export interface CostSettings {
  machineRatePerHour: DecimalInput;
  purgeWastePercent: DecimalInput;
  failureAllowancePercent: DecimalInput;
  laborCostPerUnit: DecimalInput;
  packagingCostPerUnit: DecimalInput;
  markupMultiplier: DecimalInput;
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
  subtotal: string;
  markupMultiplier: string;
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
 *   unitPrice        = subtotal × markupMultiplier
 */
export class UnitCostCalculator {
  private readonly machineRate: Big;
  private readonly purgeWaste: Big;
  private readonly failureAllowance: Big;
  private readonly labor: Big;
  private readonly packaging: Big;
  private readonly markup: Big;

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
    this.markup = toBig(settings.markupMultiplier, 'markupMultiplier');
    if (this.markup.lte(0))
      throw new PricingError('markupMultiplier must be greater than 0');
  }

  price(input: UnitCostInput): UnitPriceBreakdown {
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

    return {
      materialCost: money(materialCost),
      machineCost: money(machineCost),
      wasteCost: money(wasteCost),
      failureAllowance: money(failureAllowance),
      laborCost: money(this.labor),
      packagingCost: money(this.packaging),
      subtotal: money(subtotal),
      markupMultiplier: this.markup.toString(),
      unitPrice: money(subtotal.times(this.markup)),
    };
  }
}
