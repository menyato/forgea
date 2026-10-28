import { Money, USD } from '~/components/money';
import type { LiveQuote } from './live-quote';

/** The labeled price lines, the total (also in the chosen currency) and the deposit notice. */
export function OrderSummary({ live }: { live: LiveQuote }) {
  const { quote, currency, totalInCurrency, depositInCurrency } = live;
  const showConverted = !currency.isBase;

  return (
    <section
      aria-labelledby="summary-heading"
      className="grid gap-4 rounded-lg border border-border bg-surface p-5"
    >
      <h2 id="summary-heading" className="font-display text-xl font-bold">
        Order summary
      </h2>
      <dl className="grid gap-2 text-sm">
        {quote.summary.map((line) => (
          <div key={line.kind} className="flex justify-between gap-4">
            <dt className="text-text-muted">{line.label}</dt>
            <dd>
              <Money amount={line.amount} />
            </dd>
          </div>
        ))}
        <div className="mt-2 flex justify-between gap-4 border-t border-border pt-3 text-base font-semibold">
          <dt>Total</dt>
          <dd className="text-right">
            <Money amount={quote.total} />
            {showConverted && (
              <span className="block text-sm font-normal text-text-muted">
                ≈ <Money amount={totalInCurrency} currency={currency} />
              </span>
            )}
          </dd>
        </div>
      </dl>

      {Number(quote.depositRequired) > 0 && (
        <p className="rounded-md bg-background p-3 text-sm">
          <strong>50% deposit to start custom items:</strong>{' '}
          <Money amount={quote.depositRequired} currency={USD} />
          {showConverted && (
            <>
              {' '}
              (≈ <Money amount={depositInCurrency} currency={currency} />)
            </>
          )}
          . We begin production once it's received; the rest is due on delivery.
        </p>
      )}
      {showConverted && (
        <p className="text-xs text-text-muted">
          At 1 USD = {Number(currency.rate).toLocaleString('en-US')}{' '}
          {currency.code}, our current rate.
        </p>
      )}
    </section>
  );
}
