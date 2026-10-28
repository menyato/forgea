import {
  type CheckoutResult,
  type CurrencyQuote,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  type StoreSettings,
} from '@forgea/types';
import { Link } from 'react-router';
import { Money, USD } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { TransferDetails } from '~/features/orders/transfer-details';

/** Shown in place of the form once the order exists. */
export function OrderConfirmation({
  result,
  currencies,
  store,
}: {
  result: CheckoutResult;
  currencies: readonly CurrencyQuote[];
  /** Null only if the API couldn't send it; the page then skips the numbers. */
  store: StoreSettings | null;
}) {
  const currency = currencies.find((c) => c.code === result.currencyCode) ?? {
    ...USD,
    isBase: true,
  };
  const converted = result.currencyCode !== 'USD';
  const depositDue = Number(result.depositRequired) > 0;
  const payFull = result.paymentMethod === PaymentMethod.TRANSFER;

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-16">
      <p className="text-sm font-semibold text-success">Order placed</p>
      <h1 className="font-display text-4xl font-bold">
        Thank you — we've got it.
      </h1>
      <p>
        Your order number is{' '}
        <strong className="font-mono text-lg">{result.orderNumber}</strong>. You
        can follow it any time in My orders.
      </p>
      <dl className="grid gap-2 rounded-lg border border-border bg-surface p-5 text-sm">
        <div className="flex justify-between">
          <dt className="text-text-muted">Total</dt>
          <dd>
            <Money amount={result.total} />
            {converted && (
              <span className="ml-2 text-text-muted">
                (<Money amount={result.totalInCurrency} currency={currency} />)
              </span>
            )}
          </dd>
        </div>
        {depositDue && (
          <div className="flex justify-between">
            <dt className="text-text-muted">Deposit to start production</dt>
            <dd>
              <Money amount={result.depositRequired} />
              {converted && (
                <span className="ml-2 text-text-muted">
                  (
                  <Money
                    amount={result.depositInCurrency}
                    currency={currency}
                  />
                  )
                </span>
              )}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-text-muted">Payment</dt>
          <dd>{PAYMENT_METHOD_LABELS[result.paymentMethod]}</dd>
        </div>
      </dl>
      {store && (payFull || depositDue) ? (
        <TransferDetails
          store={store}
          amount={payFull ? result.total : result.depositRequired}
          amountInCurrency={
            payFull ? result.totalInCurrency : result.depositInCurrency
          }
          currency={currency}
          orderNumber={result.orderNumber}
        />
      ) : (
        <p className="text-text-muted">We will call you before delivering.</p>
      )}
      <p className="flex flex-wrap gap-3">
        {store && (
          <WhatsAppLink
            phone={store.whatsappPhone}
            message={`Hello Forgea! About my order ${result.orderNumber}`}
            className={buttonClass('primary')}
          >
            Chat with us on WhatsApp
          </WhatsAppLink>
        )}
        <Link to="/orders" className={buttonClass('secondary')}>
          My orders
        </Link>
        <Link to="/shop" className={buttonClass('secondary')}>
          Continue shopping
        </Link>
      </p>
    </main>
  );
}
