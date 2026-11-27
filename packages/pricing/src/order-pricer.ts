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

export interface BulkDiscountTier {
  /** Applies to a cart line whose quantity is at least this. */
  minQuantity: number;
  percent: DecimalInput;
}

/** Customer-facing order settings. Safe to send to the browser for live recalculation. */
export interface OrderSettings {
  rushFeePercent: DecimalInput;
  deliveryFee: DecimalInput;
  /** The deposit's share (50 by default) of what it is taken on (the rules below). */
  depositPercent: DecimalInput;
  /** Off: no order pays a deposit. */
  depositEnabled: boolean;
  /** Orders whose items come to more than this (USD) pay the deposit on all of them; null: never. */
  depositAboveTotal: DecimalInput | null;
  /** Made-to-order lines pay the deposit on themselves, whatever the order's total. */
  depositOnCustom: boolean;
  bulkDiscountTiers: readonly BulkDiscountTier[];
}

export interface OrderLineInput {
  id: string;
  name: string;
  /** From UnitCostCalculator (server) — the browser receives it, never the cost inputs. */
  unitPrice: DecimalInput;
  quantity: number;
  /** Custom/quote-based items require the deposit. */
  isCustom: boolean;
}

/** Any cart-like line (the API's CartLine, the storefront's copy of it). */
export interface CartLineLike {
  /** The cart line; the quote's lines keep it, so each can be matched back to its options. */
  id: string;
  name: string;
  unitPrice: DecimalInput;
  quantity: number;
  isCustom: boolean;
}

/** Cart lines → pricing input. One mapping for checkout on the server and live totals in the browser. */
export function orderLinesFromCart(
  lines: readonly CartLineLike[],
): OrderLineInput[] {
  return lines.map((l) => ({
    id: l.id,
    name: l.name,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    isCustom: l.isCustom,
  }));
}

export interface OrderOptions {
  rush: boolean;
  delivery: boolean;
}

export interface QuotedLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: string;
  /** quantity × unitPrice, before discount. */
  grossTotal: string;
  discountPercent: string;
  lineTotal: string;
  isCustom: boolean;
}

export type SummaryKind =
  'items' | 'bulk-discount' | 'rush-fee' | 'delivery-fee';

/** One clearly labeled row of the order summary. Discounts are negative amounts. */
export interface SummaryLine {
  kind: SummaryKind;
  label: string;
  amount: string;
}

/** All amounts are in the base currency (USD), 2 decimals. Use CurrencyConverter for others. */
export interface OrderQuote {
  lines: QuotedLine[];
  summary: SummaryLine[];
  total: string;
  /** depositPercent of what the deposit rules take it on (`depositBase`); "0.00" when none applies. */
  depositRequired: string;
}

/**
 * Prices a whole order from unit prices: bulk discount per line, then rush fee and delivery fee
 * as separate labeled lines. Used identically by the browser (live totals) and the API (the
 * authoritative price when the order is placed).
 */
export class OrderPricer {
  private readonly rushFee: Big;
  private readonly deliveryFee: Big;
  private readonly deposit: Big;
  private readonly depositOn: {
    enabled: boolean;
    above: Big | null;
    custom: boolean;
  };
  /** Highest threshold first, so the first match is the best tier. */
  private readonly tiers: readonly { minQuantity: number; percent: Big }[];

  constructor(settings: OrderSettings) {
    this.rushFee = requirePercent(
      toBig(settings.rushFeePercent, 'rushFeePercent'),
      'rushFeePercent',
    );
    this.deliveryFee = requireNonNegative(
      toBig(settings.deliveryFee, 'deliveryFee'),
      'deliveryFee',
    );
    this.deposit = requirePercent(
      toBig(settings.depositPercent, 'depositPercent'),
      'depositPercent',
    );
    this.depositOn = {
      enabled: settings.depositEnabled,
      above:
        settings.depositAboveTotal === null
          ? null
          : requireNonNegative(
              toBig(settings.depositAboveTotal, 'depositAboveTotal'),
              'depositAboveTotal',
            ),
      custom: settings.depositOnCustom,
    };

    const seen = new Set<number>();
    this.tiers = settings.bulkDiscountTiers
      .map((t, i) => {
        if (!Number.isInteger(t.minQuantity) || t.minQuantity < 2) {
          throw new PricingError(
            `bulkDiscountTiers[${i}].minQuantity must be an integer of at least 2`,
          );
        }
        if (seen.has(t.minQuantity)) {
          throw new PricingError(
            `bulkDiscountTiers has two tiers for ${t.minQuantity} units`,
          );
        }
        seen.add(t.minQuantity);
        const field = `bulkDiscountTiers[${i}].percent`;
        return {
          minQuantity: t.minQuantity,
          percent: requirePercent(toBig(t.percent, field), field),
        };
      })
      .sort((a, b) => b.minQuantity - a.minQuantity);
  }

  /** The bulk discount percent for a line of this quantity (0 when no tier applies). */
  discountFor(quantity: number): Big {
    return (
      this.tiers.find((t) => quantity >= t.minQuantity)?.percent ?? new Big(0)
    );
  }

  /**
   * What the deposit is taken on: nothing when it is off; all the items when they come to more
   * than the amount set; else the made-to-order lines when those always pay one.
   */
  private depositBase(items: Big, custom: Big): Big {
    const { enabled, above, custom: onCustom } = this.depositOn;
    if (!enabled) return new Big(0);
    if (above !== null && items.gt(above)) return items;
    return onCustom ? custom : new Big(0);
  }

  quote(lines: readonly OrderLineInput[], options: OrderOptions): OrderQuote {
    if (lines.length === 0)
      throw new PricingError('An order needs at least one line');

    let gross = new Big(0);
    let discounted = new Big(0);
    let customTotal = new Big(0);

    const quoted = lines.map((line, i): QuotedLine => {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new PricingError(
          `lines[${i}].quantity must be a whole number of at least 1`,
        );
      }
      const unitPrice = requireNonNegative(
        toBig(line.unitPrice, `lines[${i}].unitPrice`),
        `lines[${i}].unitPrice`,
      );
      const lineGross = unitPrice.times(line.quantity);
      const percent = this.discountFor(line.quantity);
      // Round each line so the customer can check every line total on its own.
      const lineTotal = new Big(
        money(lineGross.minus(percentOf(lineGross, percent))),
      );

      gross = gross.plus(lineGross);
      discounted = discounted.plus(lineTotal);
      if (line.isCustom) customTotal = customTotal.plus(lineTotal);

      return {
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        unitPrice: money(unitPrice),
        grossTotal: money(lineGross),
        discountPercent: percent.toString(),
        lineTotal: money(lineTotal),
        isCustom: line.isCustom,
      };
    });

    const summary: SummaryLine[] = [
      { kind: 'items', label: 'Items', amount: money(gross) },
    ];
    let total = new Big(money(gross));

    const discount = new Big(money(gross)).minus(discounted);
    if (discount.gt(0)) {
      summary.push({
        kind: 'bulk-discount',
        label: 'Bulk discount',
        amount: money(discount.times(-1)),
      });
      total = total.minus(discount);
    }
    if (options.rush && this.rushFee.gt(0)) {
      const fee = new Big(money(percentOf(discounted, this.rushFee)));
      summary.push({
        kind: 'rush-fee',
        label: `Rush fee (${this.rushFee.toString()}%)`,
        amount: money(fee),
      });
      total = total.plus(fee);
    }
    if (options.delivery) {
      summary.push({
        kind: 'delivery-fee',
        label: 'Delivery',
        amount: money(this.deliveryFee),
      });
      total = total.plus(this.deliveryFee);
    }

    return {
      lines: quoted,
      summary,
      total: money(total),
      depositRequired: money(
        percentOf(this.depositBase(discounted, customTotal), this.deposit),
      ),
    };
  }
}
