import Big from 'big.js';
import { PricingError } from './errors.js';
import { type DecimalInput, toBig } from './money.js';

/**
 * A currency as configured by the admin (the Currency table). Prices are defined in the base
 * currency (USD); every other currency is reached through an admin-set exchange rate.
 */
export interface CurrencySpec {
  /** ISO 4217 code, e.g. "USD", "LBP". */
  code: string;
  /** Decimal places shown and stored: USD 2, LBP 0. */
  decimals: number;
  /** Smallest amount cash can pay, e.g. "0.01" for USD, "5000" for LBP. */
  roundingStep: DecimalInput;
}

/**
 * Converts base-currency amounts into one target currency at a fixed rate
 * (units of the target per 1 unit of base), rounding half-up to the cash step.
 * One instance per currency and rate, so a whole order is converted consistently.
 */
export class CurrencyConverter {
  readonly code: string;
  private readonly rate: Big;
  private readonly step: Big;
  private readonly decimals: number;

  constructor(currency: CurrencySpec, rate: DecimalInput) {
    if (!/^[A-Z]{3}$/.test(currency.code)) {
      throw new PricingError(
        `currency code must be 3 capital letters, got "${currency.code}"`,
      );
    }
    if (
      !Number.isInteger(currency.decimals) ||
      currency.decimals < 0 ||
      currency.decimals > 4
    ) {
      throw new PricingError(
        `${currency.code} decimals must be a whole number from 0 to 4`,
      );
    }
    this.code = currency.code;
    this.decimals = currency.decimals;
    this.step = toBig(currency.roundingStep, `${currency.code} roundingStep`);
    if (this.step.lte(0))
      throw new PricingError(
        `${currency.code} roundingStep must be greater than 0`,
      );
    this.rate = toBig(rate, `${currency.code} rate`);
    if (this.rate.lte(0))
      throw new PricingError(`${currency.code} rate must be greater than 0`);
  }

  get exchangeRate(): string {
    return this.rate.toString();
  }

  /** Base amount → this currency, rounded to the cash step, as a fixed-decimal string. */
  convert(baseAmount: DecimalInput): string {
    return toBig(baseAmount, 'amount')
      .times(this.rate)
      .div(this.step)
      .round(0, Big.roundHalfUp)
      .times(this.step)
      .toFixed(this.decimals);
  }
}

/** "1234.5", USD → "$1,234.50"; "170005000", LBP → "LBP 170,005,000". */
export function formatMoney(
  amount: DecimalInput,
  currency: Pick<CurrencySpec, 'code' | 'decimals'>,
): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.code,
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(Number(toBig(amount, 'amount').toFixed(currency.decimals)));
}
