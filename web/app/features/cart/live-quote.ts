import {
  type CartLineLike,
  CurrencyConverter,
  OrderPricer,
  orderLinesFromCart,
  type OrderOptions,
  type OrderQuote,
  type OrderSettings,
} from '@forgea/pricing';
import type { CurrencyQuote } from '@forgea/types';
import { useMemo } from 'react';

export interface LiveQuote {
  quote: OrderQuote;
  currency: CurrencyQuote;
  totalInCurrency: string;
  depositInCurrency: string;
}

/** The base currency (USD) — always present, the fallback for unknown codes. */
const baseCurrency = (currencies: readonly CurrencyQuote[]): CurrencyQuote =>
  currencies.find((c) => c.isBase) ?? {
    code: 'USD',
    name: 'US dollar',
    decimals: 2,
    roundingStep: '0.01',
    isBase: true,
    rate: '1',
    rateEffectiveFrom: null,
  };

/**
 * Totals recalculated in the browser as the shopper changes options, with the same engine
 * (@forgea/pricing) and settings the API uses — so what they see is what checkout charges.
 * The API still re-prices the order itself when it is placed.
 */
export function quoteFor(
  lines: readonly CartLineLike[],
  settings: OrderSettings,
  options: OrderOptions,
  currencies: readonly CurrencyQuote[],
  currencyCode: string,
): LiveQuote | null {
  if (lines.length === 0) return null;
  const quote = new OrderPricer(settings).quote(
    orderLinesFromCart(lines),
    options,
  );
  const currency =
    currencies.find((c) => c.code === currencyCode) ?? baseCurrency(currencies);
  const converter = new CurrencyConverter(currency, currency.rate);
  return {
    quote,
    currency,
    totalInCurrency: converter.convert(quote.total),
    depositInCurrency: converter.convert(quote.depositRequired),
  };
}

export function useLiveQuote(
  lines: readonly CartLineLike[],
  settings: OrderSettings,
  options: OrderOptions,
  currencies: readonly CurrencyQuote[],
  currencyCode: string,
): LiveQuote | null {
  const { rush, delivery } = options;
  return useMemo(
    () =>
      quoteFor(lines, settings, { rush, delivery }, currencies, currencyCode),
    [lines, settings, rush, delivery, currencies, currencyCode],
  );
}
