import type { PaymentState } from '@forgea/types';
import { Prisma } from '../generated/prisma/client.js';

/** An amount as Prisma returns it, or as the API receives it (a decimal string). */
export type Amount = Prisma.Decimal | string | number;

const D = (v: Amount) => new Prisma.Decimal(v);

/**
 * A tax-included amount split into its base and its tax, to the cent: shop prices include the
 * sales tax (when the owner sets one), so an invoice separates it. base + tax = gross, always.
 */
export function splitTaxIncluded(
  gross: Amount,
  ratePercent: Amount | null,
): { base: Prisma.Decimal; tax: Prisma.Decimal } {
  const g = D(gross);
  if (ratePercent === null || D(ratePercent).isZero())
    return { base: g, tax: D(0) };
  const base = g.times(100).div(D(100).plus(ratePercent)).toDecimalPlaces(2);
  return { base, tax: g.minus(base) };
}

/** Whether lines balance: total debit = total credit, and something is booked. */
export function isBalanced(
  lines: readonly { debit: Amount; credit: Amount }[],
): boolean {
  const debit = lines.reduce((s, l) => s.plus(l.debit), D(0));
  const credit = lines.reduce((s, l) => s.plus(l.credit), D(0));
  return debit.equals(credit) && debit.gt(0);
}

/**
 * Odoo's payment state for an invoice: from what is still owed, and whether a credit note
 * (rather than a payment) settled it.
 */
export function paymentState(
  total: Amount,
  residual: Amount,
  settledByCreditNoteOnly: boolean,
): PaymentState {
  if (D(residual).lte(0)) return settledByCreditNoteOnly ? 'reversed' : 'paid';
  return D(residual).gte(total) ? 'not_paid' : 'partial';
}

/** "INV/2026/00001": the journal (or "R" + it for credit notes), the year, the count. */
export function entryNumber(prefix: string, year: number, n: number): string {
  return `${prefix}/${year}/${String(n).padStart(5, '0')}`;
}
