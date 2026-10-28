import type { StoreSettings } from '@forgea/types';
import { type CurrencyFormat, Money } from '~/components/money';

/**
 * How to pay by money transfer: the studio's number (set by the admin), what to send,
 * and what to write in the note so the payment is matched to the order.
 */
export function TransferDetails({
  store,
  amount,
  amountInCurrency,
  currency,
  orderNumber,
}: {
  store: StoreSettings;
  /** USD amount to send now: the total, or the deposit for custom work. */
  amount: string;
  /** The same amount in the shopper's chosen currency, when it isn't USD. */
  amountInCurrency?: string | undefined;
  currency?: CurrencyFormat | undefined;
  /** Known once the order is placed. */
  orderNumber?: string | undefined;
}) {
  const converted = currency && amountInCurrency && currency.code !== 'USD';
  return (
    <div className="grid gap-2 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
      <p>
        Send <Money amount={amount} />
        {converted && (
          <span className="text-text-muted">
            {' '}
            (or <Money amount={amountInCurrency} currency={currency} />)
          </span>
        )}{' '}
        to
      </p>
      <p className="font-mono text-2xl font-bold tracking-wide">
        <a href={`tel:${store.transferPhone.replace(/[^\d+]/g, '')}`}>
          {store.transferPhone}
        </a>
      </p>
      {store.transferInstructions && <p>{store.transferInstructions}</p>}
      <p className="text-text-muted">
        {orderNumber ? (
          <>
            Write <strong className="font-mono text-text">{orderNumber}</strong>{' '}
            in the transfer note so we can match your payment.
          </>
        ) : (
          'You get your order number on the next page — put it in the transfer note.'
        )}
      </p>
    </div>
  );
}
