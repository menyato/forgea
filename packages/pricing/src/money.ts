import Big from 'big.js';
import { PricingError } from './errors.js';

/**
 * Amounts cross package boundaries as decimal strings ("12.50"): JSON-safe and exactly what
 * Prisma's Decimal prints. Numbers are accepted for convenience and converted via their string form.
 */
export type DecimalInput = string | number;

/** Parses a decimal, rejecting NaN, Infinity and malformed strings with a clear field name. */
export function toBig(value: DecimalInput, field: string): Big {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new PricingError(`${field} must be a finite number`);
  }
  try {
    return new Big(value);
  } catch {
    throw new PricingError(
      `${field} must be a decimal number, got "${String(value)}"`,
    );
  }
}

/** Round half-up to 2 decimals (cents) and format with exactly two places. */
export function money(value: Big): string {
  return value.round(2, Big.roundHalfUp).toFixed(2);
}

export function percentOf(amount: Big, percent: Big): Big {
  return amount.times(percent).div(100);
}

export function requireNonNegative(value: Big, field: string): Big {
  if (value.lt(0)) throw new PricingError(`${field} must not be negative`);
  return value;
}

export function requirePercent(value: Big, field: string): Big {
  if (value.lt(0) || value.gt(100))
    throw new PricingError(`${field} must be between 0 and 100`);
  return value;
}
