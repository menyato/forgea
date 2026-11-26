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
  /**
   * The shop's lines this piece leaves out (a product without packaging, sold at cost): each
   * counts 0, in its cost and its price.
   */
  off?: readonly PriceLineKey[] | undefined;
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

    const off = new Set(input.off ?? []);
    const unless = (key: PriceLineKey, amount: Big) =>
      off.has(key) ? new Big(0) : amount;
    const materialCost = unless('material', grams.times(pricePerGram));
    const machineCost = unless('machine', hours.times(this.machineRate));
    const base = materialCost.plus(machineCost);
    const wasteCost = input.wasteIncluded
      ? base.times(0)
      : unless('waste', percentOf(base, this.purgeWaste));
    const failureAllowance = unless(
      'failure',
      percentOf(base, this.failureAllowance),
    );
    const laborCost = unless('labor', this.labor);
    const packagingCost = unless('packaging', this.packaging);
    const extraCost = requireNonNegative(
      toBig(input.extraCost ?? 0, 'extraCost'),
      'extraCost',
    );
    const subtotal = base
      .plus(wasteCost)
      .plus(failureAllowance)
      .plus(laborCost)
      .plus(packagingCost)
      .plus(extraCost);
    const value = toBig(rule.value, 'profit');
    const profitAmount = unless(
      'profit',
      rule.kind === 'PERCENT' ? percentOf(subtotal, value) : value,
    );

    return {
      materialCost: money(materialCost),
      machineCost: money(machineCost),
      wasteCost: money(wasteCost),
      failureAllowance: money(failureAllowance),
      laborCost: money(laborCost),
      packagingCost: money(packagingCost),
      extraCost: money(extraCost),
      subtotal: money(subtotal),
      profit: money(profitAmount),
      profitRule: { kind: rule.kind, value: value.toString() },
      unitPrice: money(subtotal.plus(profitAmount)),
    };
  }
}

/** The shop's price lines a product or a quote may leave out (`UnitCostInput.off`, `quoteWith`). */
export type PriceLineKey =
  | 'material'
  | 'machine'
  | 'waste'
  | 'failure'
  | 'labor'
  | 'packaging'
  | 'profit';

/** A cost the owner adds to a quote (USD, for the whole quote). */
export interface AddedCost {
  label: string;
  amount: DecimalInput;
}

/** A whole quote (all pieces), line by line, as `UnitCostCalculator.quote` worked it out. */
export interface QuoteBreakdown {
  pieces: number;
  /** Each line for all pieces; `on` false: switched off (not counted). */
  lines: { key: PriceLineKey; amount: string; on: boolean }[];
  added: { label: string; amount: string }[];
  /** What it costs the studio: the lines switched on (but profit) and the added costs. */
  subtotal: string;
  profit: string;
  profitRule: { kind: ProfitKind; value: string };
  /** One piece at the shop's price step, and all of them: the price to quote. */
  unitPrice: string;
  price: string;
}

export interface QuoteAdjustments {
  /** Lines left out of the price. */
  off?: ReadonlySet<PriceLineKey> | undefined;
  /** Costs added before profit (the profit rule applies to them). */
  added?: readonly AddedCost[] | undefined;
}

/**
 * A quote for `pieces` pieces by the shop's rules, which the owner may adjust: lines switched
 * off and costs added (before profit). Without adjustments it is exactly the shop's price
 * (`shopPrice(price(input).unitPrice)` per piece), so a quote never drifts from the shop.
 */
export function quoteWith(
  calculator: UnitCostCalculator,
  input: UnitCostInput,
  pieces: number,
  { off = new Set(), added = [] }: QuoteAdjustments = {},
  profit?: ProfitRule | null,
): QuoteBreakdown {
  if (!Number.isInteger(pieces) || pieces < 1)
    throw new PricingError('pieces must be a whole number of at least 1');
  const n = new Big(pieces);
  // Lines the piece itself leaves out (a product's) and the ones switched off here.
  const offAll = new Set<PriceLineKey>([...(input.off ?? []), ...off]);
  // Every line's full amount, to show beside its switch; the piece as priced, with lines off.
  const full = calculator.price({ ...input, off: undefined }, profit);
  const priced = calculator.price({ ...input, off: [...offAll] }, profit);
  const lines: QuoteBreakdown['lines'] = (
    [
      ['material', full.materialCost],
      ['machine', full.machineCost],
      ['waste', full.wasteCost],
      ['failure', full.failureAllowance],
      ['labor', full.laborCost],
      ['packaging', full.packagingCost],
    ] as const
  ).map(([key, amount]) => ({
    key,
    amount: money(toBig(amount, key).times(n)),
    on: !offAll.has(key),
  }));
  let subtotal = toBig(priced.subtotal, 'subtotal').times(n);
  const addedLines = added.map((a) => {
    const amount = requireNonNegative(
      toBig(a.amount, 'added cost'),
      'added cost',
    );
    subtotal = subtotal.plus(amount);
    return { label: a.label, amount: money(amount) };
  });
  const rule = full.profitRule;
  const profitOn = !offAll.has('profit');
  const profitAll =
    rule.kind === 'PERCENT'
      ? percentOf(subtotal, toBig(rule.value, 'profit'))
      : toBig(rule.value, 'profit').times(n);
  lines.push({ key: 'profit', amount: money(profitAll), on: profitOn });
  const total = profitOn ? subtotal.plus(profitAll) : subtotal;
  // Nothing added: the calculator's own unit price (from unrounded components), as the shop
  // prices the same piece.
  const unitPrice = calculator.shopPrice(
    added.length === 0 ? priced.unitPrice : total.div(n).toString(),
  );
  return {
    pieces,
    lines,
    added: addedLines,
    subtotal: money(subtotal),
    profit: money(profitOn ? profitAll : new Big(0)),
    profitRule: rule,
    unitPrice,
    price: money(toBig(unitPrice, 'unitPrice').times(n)),
  };
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
