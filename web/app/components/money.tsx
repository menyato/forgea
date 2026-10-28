import { formatMoney } from '@forgea/pricing';

export interface CurrencyFormat {
  code: string;
  decimals: number;
}

export const USD: CurrencyFormat = { code: 'USD', decimals: 2 };

/** A money amount in a currency, with tabular digits so columns of prices line up. */
export function Money({
  amount,
  currency = USD,
}: {
  amount: string;
  currency?: CurrencyFormat;
}) {
  return <span className="tabular-nums">{formatMoney(amount, currency)}</span>;
}
