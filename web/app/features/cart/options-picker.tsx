import type { CurrencyQuote } from '@forgea/types';

export interface CheckoutOptions {
  delivery: boolean;
  rush: boolean;
  currency: string;
}

/**
 * Delivery vs pickup, rush, and the currency to pay in. Controlled, so the order summary
 * recalculates instantly. With `named`, the inputs also submit with the checkout form.
 */
export function OptionsPicker({
  value,
  currencies,
  onChange,
  named = false,
  allowRush = true,
}: {
  value: CheckoutOptions;
  currencies: readonly CurrencyQuote[];
  onChange: (next: CheckoutOptions) => void;
  named?: boolean;
  /** Off when rush doesn't apply (an accepted quote already covers timing). */
  allowRush?: boolean;
}) {
  const name = (n: string) => (named ? n : undefined);
  return (
    <fieldset className="grid gap-3 rounded-lg border border-border bg-surface p-5">
      <legend className="px-1 font-display text-lg font-bold">
        Delivery and payment
      </legend>
      <div
        className="grid gap-2 text-sm"
        role="radiogroup"
        aria-label="How to receive the order"
      >
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={name('fulfilment') ?? 'fulfilment-preview'}
            value="delivery"
            checked={value.delivery}
            onChange={() => onChange({ ...value, delivery: true })}
          />
          Deliver to me
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={name('fulfilment') ?? 'fulfilment-preview'}
            value="pickup"
            checked={!value.delivery}
            onChange={() => onChange({ ...value, delivery: false })}
          />
          Pick up from the studio (no delivery fee)
        </label>
      </div>
      {allowRush && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name('rush')}
            checked={value.rush}
            onChange={(e) =>
              onChange({ ...value, rush: e.currentTarget.checked })
            }
          />
          Rush — move to the front of the queue
        </label>
      )}
      <label className="grid gap-1 text-sm">
        <span>Pay in</span>
        <select
          name={name('currency')}
          value={value.currency}
          onChange={(e) =>
            onChange({ ...value, currency: e.currentTarget.value })
          }
          className="rounded-md border border-border bg-surface px-2 py-1.5"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
